(() => {
  const PRESETS = window.JET_PRESETS;
  const $ = (s) => document.querySelector(s);
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const fmt = (x, d = 0) => x.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

  let spec = { ...PRESETS[0] };
  let presetId = PRESETS[0].id;
  let environment = 'runway';
  const params = { listener: 'ground', env: 'runway', angle: 90, dist: 40, seat: 'wing', alt: 150, speed: 300, fan: 1, core: 1, jet: 1, master: 0.8 };
  let observer = 'ground', board = 'cabin', groundMode = 'ground';

  let audio = null;
  let running = false;
  let tla = 0, tlaSent = -1, reverser = false;
  let tele = { state: 'off', n1: 0, n2: 0, np: 0, egt: 20, ff: 0, thrust: 0, spl: 0, ph: 0, phP: 0, f1: 0, fp: 0, Mt: 0, ab: 0, rev: 0 };
  const held = { up: 0, down: 0 };

  const ARCH = { turbojet: 'Turbojato', turbofan: 'Turbofan', geared: 'Turbofan com redutor', turboprop: 'Turboélice' };

  // ------------------------------------------------------------------ áudio
  const DSP = JetDSPFactory().JetDSP;

  function engineConfig(sr) {
    const cfg = { ...spec };
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
    const src = `const JetDSP = (${JetDSPFactory.toString()})().JetDSP;
class TurbinaProcessor extends AudioWorkletProcessor {
  constructor() { super(); this.d = new JetDSP(sampleRate); this.d.post = (m) => this.port.postMessage(m); this.port.onmessage = (e) => this.d.message(e.data); }
  process(inputs, outputs) { const o = outputs[0]; this.d.process(o[0], o[1], o[0].length, o[2], o[3]); return true; }
}
registerProcessor('turbina-engine', TurbinaProcessor);`;
    try {
      // blob: funciona em http(s); em file:// a origem é nula e só data: carrega
      const urls = [URL.createObjectURL(new Blob([src], { type: 'application/javascript' })), `data:text/javascript;charset=utf-8,${encodeURIComponent(src)}`];
      let loaded = false;
      for (const url of urls) {
        try { await ctx.audioWorklet.addModule(url); loaded = true; break; } catch (e) { /* tenta o próximo */ }
      }
      if (!loaded) throw new Error('AudioWorklet indisponível');
      node = new AudioWorkletNode(ctx, 'turbina-engine', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [4] });
      node.port.onmessage = (e) => onTelemetry(e.data);
      send = (m) => node.port.postMessage(m);
    } catch (err) {
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
    const wetLP = ctx.createBiquadFilter(); wetLP.type = 'lowpass'; wetLP.frequency.value = 16000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 3.5; comp.attack.value = 0.006; comp.release.value = 0.3;
    const out = ctx.createGain(); out.gain.value = 1.3;
    const analyser = ctx.createAnalyser(); analyser.fftSize = 8192; analyser.smoothingTimeConstant = 0.6;
    toDry.connect(dry); toWet.connect(conv); conv.connect(wetLP); wetLP.connect(wet);
    dry.connect(comp); wet.connect(comp); comp.connect(out); out.connect(analyser); analyser.connect(ctx.destination);
    audio = { ctx, node, send, dry, wet, wetLP, conv, analyser };
    setEnvironment(environment);
    send({ type: 'config', cfg: engineConfig(ctx.sampleRate) });
    send({ type: 'params', params });
    send({ type: 'input', tla, reverser });
    return audio;
  }

  // Acústica de cada lugar: cauda difusa + ecos discretos (terminal, paredes, encostas).
  const ENVS = {
    runway: { name: 'Pista aberta', len: 0.7, tau: 0.07, diff: 0.3, wet: 0.08, echoes: [[0.008, 0.4, 0.001]] },
    apron: { name: 'Pátio do terminal', len: 1.8, tau: 0.3, diff: 0.45, wet: 0.3, dark: 0.5,
      echoes: [[0.18, 0.5, 0.01], [0.26, 0.35, 0.015], [0.33, 0.2, 0.02], [0.5, 0.12, 0.04]] },
    hangar: { name: 'Hangar', len: 4.5, tau: 1.3, diff: 1, wet: 0.6, dark: 0.4,
      echoes: [[0.03, 0.4, 0.004], [0.07, 0.35, 0.006], [0.12, 0.3, 0.01]] },
    testcell: { name: 'Célula de teste', len: 2.5, tau: 0.6, diff: 1, wet: 0.5, dark: 0.55, flutter: 0.028,
      echoes: [[0.014, 0.5, 0.002], [0.028, 0.4, 0.003], [0.056, 0.3, 0.006]] },
    valley: { name: 'Vale (voo rasante)', len: 4, tau: 0.3, diff: 0.25, wet: 0.4, dark: 0.8,
      echoes: [[0.6, 0.5, 0.04], [1.1, 0.35, 0.06], [1.7, 0.25, 0.08], [2.4, 0.15, 0.12], [3.2, 0.08, 0.15]] },
    carrier: { name: 'Porta-aviões', len: 1.2, tau: 0.1, diff: 0.3, wet: 0.18, dark: 0.3,
      echoes: [[0.004, 0.6, 0.001], [0.045, 0.35, 0.004], [0.09, 0.15, 0.01]] },
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

  // A bordo o lugar lá fora chega abafado pela fuselagem.
  function applyListenerAcoustics() {
    if (!audio) return;
    const inside = params.listener === 'cabin' || params.listener === 'cockpit';
    const t = audio.ctx.currentTime;
    audio.wetLP.frequency.setTargetAtTime(inside ? 500 : 16000, t, 0.05);
    audio.wet.gain.setTargetAtTime(ENVS[environment].wet * (inside ? 0.3 : 1), t, 0.05);
  }

  let rebuildTimer = 0;
  function pushConfig(structural) {
    updatePlate();
    if (!audio) return;
    if (structural) {
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => audio.send({ type: 'config', cfg: engineConfig(audio.ctx.sampleRate) }), 60);
    } else {
      audio.send({ type: 'tune', cfg: { ...spec } });
    }
  }

  function sendParams() { audio?.send({ type: 'params', params }); }

  function setTla(v) {
    tla = clamp(v, 0, spec.ab && spec.arch !== 'turboprop' ? 1.3 : 1);
    paintLever();
    if (audio && Math.abs(tla - tlaSent) > 1e-4) { audio.send({ type: 'input', tla }); tlaSent = tla; }
  }

  function setReverser(on) {
    reverser = on;
    $('#revKey').setAttribute('aria-pressed', String(on));
    audio?.send({ type: 'input', reverser: on });
  }

  async function setRunning(on) {
    await initAudio();
    if (audio.ctx.state !== 'running') await audio.ctx.resume();
    running = on;
    audio.send({ type: 'input', start: on, tla });
    paintIgnition();
  }

  function paintIgnition() {
    const st = tele.state;
    $('#ignition').setAttribute('aria-pressed', String(running));
    $('#ignLabel').textContent = !running ? (st === 'stop' ? 'Desacelerando…' : 'Dar partida') : st === 'start' ? 'Partida em curso…' : 'Cortar motor';
  }

  function onTelemetry(m) {
    if (m.type !== 'telemetry') return;
    const prev = tele.state;
    tele = m; tele.t = performance.now();
    if (prev !== m.state) paintIgnition();
  }

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

  function slider(id, label, min, max, step, value, fmtv, onInput, onChange) {
    const out = el('output', { for: id, text: fmtv(value) });
    const input = el('input', { type: 'range', id, min, max, step, value });
    const paint = () => input.style.setProperty('--p', `${((input.value - min) / (max - min)) * 100}%`);
    paint();
    input.addEventListener('input', () => { out.textContent = fmtv(+input.value); paint(); onInput(+input.value); });
    if (onChange) input.addEventListener('change', () => onChange(+input.value));
    return el('div', { class: 'field' }, [el('label', { for: id }, [el('span', { text: label }), out]), input]);
  }

  const field = (label, body, extra) => el('div', { class: 'field' }, [el('div', { class: 'lab' }, [el('span', { text: label }), extra || null]), body]);

  function setSpec(patch, { structural = false, render = true } = {}) {
    Object.assign(spec, patch);
    presetId = null;
    markPreset();
    pushConfig(structural);
    if (render) renderControls();
  }
  // parâmetro escalar: atualiza o som ao arrastar, sem redesenhar o painel
  const live = (key, structural = false) => (v) => setSpec({ [key]: v }, { structural, render: false });

  // Mach relativo na ponta do fan a 100% e situação do tom de passagem de pá (Tyler-Sofrin)
  function fanFacts(s = spec) {
    const Ut = (Math.PI * s.fanD * s.n1Max) / 60;
    const Mt = Math.hypot(Ut / 340, 0.5);
    let m = Infinity;
    for (let k = -6; k <= 6; k++) m = Math.min(m, Math.abs(s.fanB - k * s.vanes));
    const bpf = (s.fanB * s.n1Max) / 60;
    return { Mt, m, bpf, cutSub: m > s.fanB };
  }

  function renderControls() {
    const scrollTop = controls.scrollTop;
    controls.textContent = '';
    const prop = spec.arch === 'turboprop', jet = spec.arch === 'turbojet';

    // ---- Motor
    const mo = el('section', { class: 'group' }, [el('h2', { text: 'Motor' })]);
    mo.append(field('Arquitetura', chipGroup('arch', Object.entries(ARCH).map(([v, label]) => ({ value: v, label })), spec.arch, (v) => {
      const patch = { arch: v };
      if (v === 'turboprop') Object.assign(patch, { propB: spec.propB || 6, propD: spec.propD || 3.5, propRpm: spec.propRpm || 1200, ab: false });
      if (v === 'geared' && !(spec.gear > 1)) patch.gear = 3;
      if (v === 'turbojet') patch.bpr = 0;
      if ((v === 'turbofan' || v === 'geared') && !(spec.bpr > 0.2)) patch.bpr = 5;
      setSpec(patch, { structural: true });
    })));
    mo.append(field('Número de motores', chipGroup('engines', [1, 2, 3, 4].map((n) => ({ value: n, label: String(n) })), spec.engines,
      (v) => setSpec({ engines: v, span: spec.span || (v > 1 ? 6 : 0) }, { structural: true }), 'num')));
    mo.append(field('Eixos', chipGroup('spools', [
      { value: 1, label: '1', title: 'Compressor e fan no mesmo eixo: os tons andam juntos' },
      { value: 2, label: '2' }, { value: 3, label: '3', title: 'Eixo intermediário: mais uma família de tons' },
    ], spec.spools, (v) => setSpec({ spools: v }), 'num')));
    mo.append(slider('spool', 'Tempo de aceleração (lenta → máxima)', 2, 14, 0.5, spec.spoolTime, (v) => `${fmt(v, 1)} s`, live('spoolTime')));
    mo.append(slider('thrust', prop ? 'Potência (empuxo equivalente)' : 'Empuxo máximo por motor', 5, 520, 1, spec.thrust, (v) => `${fmt(v)} kN`, live('thrust'), () => updatePlate()));
    mo.append(slider('n2Idle', 'Marcha lenta (N2)', 0.45, 0.8, 0.01, spec.n2Idle, (v) => `${fmt(v * 100)} %`, live('n2Idle')));
    if (!prop) mo.append(slider('n1Idle', 'Marcha lenta (N1)', 0.12, 0.6, 0.01, spec.n1Idle, (v) => `${fmt(v * 100)} %`, live('n1Idle')));
    controls.append(mo);

    // ---- Aeronave (onde os motores ficam e o formato, que muda o estrondo sônico)
    const air = el('section', { class: 'group' }, [el('h2', { text: 'Aeronave' })]);
    air.append(field('Motores montados', chipGroup('mount', [
      { value: 'wing', label: 'Sob a asa' }, { value: 'rear', label: 'Na cauda' },
      { value: 'fuselage', label: 'Na fuselagem' }, { value: 'nose', label: 'No nariz', disabled: spec.engines > 1 },
    ], spec.mount, (v) => setSpec({ mount: v }, { structural: true }))));
    if (spec.engines > 1) air.append(slider('span', 'Distância do motor externo ao centro', 0.5, 25, 0.1, spec.span, (v) => `${fmt(v, 1)} m`, () => {}, (v) => setSpec({ span: v }, { structural: true })));
    air.append(slider('cockpitX', 'Cockpit à frente dos motores', -5, 40, 0.5, spec.cockpitX, (v) => `${fmt(v, 1)} m`, live('cockpitX')));
    air.append(slider('length', 'Comprimento', 8, 80, 1, spec.length, (v) => `${fmt(v)} m`, live('length')));
    air.append(slider('shape', 'Formato (para o estrondo sônico)', 0.05, 0.15, 0.005, spec.shape, (v) => (v < 0.075 ? 'muito afilado' : v < 0.095 ? 'afilado' : v < 0.12 ? 'normal' : 'rombudo'), live('shape')));
    controls.append(air);

    // ---- Fan ou hélice
    if (prop) {
      const pr = el('section', { class: 'group' }, [el('h2', { text: 'Hélice' })]);
      pr.append(field('Pás', chipGroup('propB', [2, 3, 4, 5, 6, 8].map((n) => ({ value: n, label: String(n) })), spec.propB, (v) => setSpec({ propB: v }), 'num')));
      pr.append(slider('propD', 'Diâmetro', 1.5, 5, 0.05, spec.propD, (v) => `${fmt(v, 2)} m`, live('propD'), () => renderControls()));
      pr.append(slider('propRpm', 'Rotação da hélice', 800, 2700, 10, spec.propRpm, (v) => `${fmt(v)} rpm`, live('propRpm'), () => renderControls()));
      const Mh = (Math.PI * spec.propD * spec.propRpm) / 60 / 340;
      pr.append(el('p', { class: Mh > 0.9 ? 'note warn' : 'note', text: `Ponta da pá a Mach ${fmt(Mh, 2)} parado. Passagem de pá: ${fmt((spec.propB * spec.propRpm) / 60)} Hz. ${Mh > 0.85 ? 'Perto do som: o ronco vira um rasgado cheio de harmônicos.' : 'Quanto mais perto de Mach 1, mais harmônicos e mais alto.'}` }));
      controls.append(pr);
    }
    const fanName = prop ? 'Gerador de gás' : jet ? 'Compressor de baixa' : 'Fan';
    const fa = el('section', { class: 'group' }, [el('h2', { text: fanName })]);
    if (!prop) {
      fa.append(slider('fanB', jet ? 'Pás do 1º estágio' : 'Pás do fan', 10, 60, 1, spec.fanB, (v) => String(v), () => {}, (v) => setSpec({ fanB: v }, { structural: true })));
      fa.append(slider('vanes', 'Palhetas guia (estator)', 10, 120, 1, spec.vanes, (v) => String(v), live('vanes'), () => renderControls()));
      fa.append(slider('fanD', 'Diâmetro', 0.3, 3.5, 0.01, spec.fanD, (v) => `${fmt(v, 2)} m`, live('fanD'), () => renderControls()));
      fa.append(slider('n1Max', 'Rotação máxima (N1)', 1500, 16000, 10, spec.n1Max, (v) => `${fmt(v)} rpm`, live('n1Max'), () => renderControls()));
      if (spec.arch === 'geared') fa.append(slider('gear', 'Redução turbina → fan', 1.5, 4, 0.01, spec.gear, (v) => `${fmt(v, 2)} : 1`, live('gear')));
      const f = fanFacts();
      fa.append(el('p', { class: f.Mt > 1 ? 'note warn' : 'note', text: `A 100%: ponta a Mach ${fmt(f.Mt, 2)}${f.Mt > 1 ? ' (supersônica: choques nas pás e buzz-saw)' : ''}. BPF ${fmt(f.bpf)} Hz. ${f.cutSub ? `Com ${spec.vanes} palhetas para ${spec.fanB} pás o BPF fica preso no duto enquanto a ponta for subsônica.` : `Com ${spec.vanes} palhetas para ${spec.fanB} pás o BPF sai do duto em qualquer rotação.`}` }));
    }
    fa.append(slider('hpcB', 'Pás do compressor de alta', 12, 80, 1, spec.hpcB, (v) => String(v), live('hpcB')));
    fa.append(slider('lptB', 'Pás da turbina de baixa', 20, 140, 1, spec.lptB, (v) => String(v), live('lptB')));
    fa.append(slider('n2Max', 'Rotação máxima (N2)', 6000, 45000, 100, spec.n2Max, (v) => `${fmt(v)} rpm`, live('n2Max')));
    controls.append(fa);

    // ---- Jato
    const je = el('section', { class: 'group' }, [el('h2', { text: 'Jato' })]);
    if (spec.arch === 'turbofan' || spec.arch === 'geared') {
      je.append(slider('bpr', 'Razão de bypass', 0.2, 15, 0.1, spec.bpr, (v) => `${fmt(v, 1)} : 1`, live('bpr')));
    }
    je.append(slider('jetV', 'Velocidade do jato primário a 100%', 80, 1000, 5, spec.jetV, (v) => `${fmt(v)} m/s`, live('jetV')));
    je.append(slider('nozD', 'Diâmetro do bocal', 0.2, 1.8, 0.01, spec.nozD, (v) => `${fmt(v, 2)} m`, live('nozD')));
    controls.append(je);

    // ---- Acessórios
    const ac = el('section', { class: 'group' }, [el('h2', { text: 'Acessórios' })]);
    ac.append(field('Pós-combustão', chipGroup('ab', [
      { value: false, label: 'Sem' }, { value: true, label: 'Com', disabled: prop, title: prop ? 'Turboélice não tem jato para reaquecer' : 'Libera a manete além de 100%' },
    ], !!spec.ab && !prop, (v) => { setSpec({ ab: v }); if (!v && tla > 1) setTla(1); paintDetents(); })));
    ac.append(field('Bocal', chipGroup('nozzle', [
      { value: 'conv', label: 'Convergente', title: 'Jato acima de Mach 1 sai com células de choque: chiado de choque e screech' },
      { value: 'cd', label: 'Convergente-divergente', title: 'Expande o jato supersônico sem choques no ponto de projeto' },
    ], spec.nozzle, (v) => setSpec({ nozzle: v }))));
    ac.append(field('Redutor de ruído do jato', chipGroup('suppressor', [
      { value: 'none', label: 'Nenhum' },
      { value: 'chevrons', label: 'Chevrons', title: 'Borda serrilhada: mistura mais rápido, menos ronco grave' },
      { value: 'hushkit', label: 'Hush kit', title: 'Misturador e ejetor: corta bastante o ronco do jato' },
    ], spec.suppressor, (v) => setSpec({ suppressor: v }))));
    ac.append(field('Revestimento acústico', chipGroup('liners', [
      { value: false, label: 'Sem' }, { value: true, label: 'Com', title: 'Painéis de colmeia na nacele absorvem os tons do fan e do compressor' },
    ], !!spec.liners, (v) => setSpec({ liners: v }))));
    if (spec.engines > 1) {
      ac.append(field('Sincronizador', chipGroup('sync', [
        { value: false, label: 'Desligado', title: 'Cada motor gira um pouco diferente: os tons batem (uón-uón)' },
        { value: true, label: 'Ligado', title: 'Iguala as rotações e acaba com o batimento' },
      ], !!spec.sync, (v) => setSpec({ sync: v }))));
    }
    ac.append(el('p', { class: 'note', text: prop ? 'Reversor (R): a hélice inverte o passo e chicoteia o ar.' : 'Reversor (R): as cascatas jogam o jato para frente. Ruge bem mais alto na lateral e na frente.' }));
    controls.append(ac);

    // ---- Escuta
    const li = el('section', { class: 'group' }, [el('h2', { text: 'Escuta' })]);
    li.append(field('Observador', chipGroup('observer', [
      { value: 'board', label: 'A bordo' }, { value: 'ground', label: 'No solo' },
    ], observer, setObserver)));
    if (observer === 'board') {
      li.append(field('Posição', chipGroup('board', [
        { value: 'cabin', label: 'Cabine de passageiros', disabled: spec.mount === 'fuselage' }, { value: 'cockpit', label: 'Cockpit' },
        { value: 'wingcam', label: spec.mount === 'wing' ? 'Câmera na asa' : 'Câmera externa' },
      ], board, (v) => { board = v; setListener(); })));
      if (board === 'cabin') {
        li.append(field('Assento', chipGroup('seat', [
          { value: 'fwd', label: 'Dianteiro' }, { value: 'wing', label: 'Sobre a asa' }, { value: 'aft', label: 'Traseiro' },
        ], params.seat, (v) => { params.seat = v; sendParams(); renderControls(); })));
      }
    } else {
      li.append(field('Situação', chipGroup('groundMode', [
        { value: 'ground', label: 'Ao redor do motor' }, { value: 'flyby', label: 'Passagem' },
      ], groundMode, (v) => { groundMode = v; setListener(); })));
      if (groundMode === 'ground') {
        li.append(slider('angle', 'Ângulo (0° = de frente para a entrada)', 0, 180, 1, params.angle, (v) => `${v}°`, (v) => { params.angle = v; sendParams(); }));
        li.append(slider('dist', 'Distância', 5, 300, 1, params.dist, (v) => `${v} m`, (v) => { params.dist = v; sendParams(); }));
      } else {
        li.append(slider('alt', 'Altura da passagem', 20, 1500, 5, params.alt, (v) => `${fmt(v)} m`, (v) => { params.alt = v; sendParams(); }));
        li.append(slider('speed', 'Velocidade', 150, 2500, 10, params.speed, (v) => `${fmt(v)} km/h · Mach ${fmt(v / 3.6 / 340, 2)}`, (v) => { params.speed = v; sendParams(); }));
      }
      li.append(el('canvas', { id: 'obsMap', class: `obs-map${groundMode === 'ground' ? ' drag' : ''}`, 'aria-label': groundMode === 'ground' ? 'Mapa: arraste para mudar onde você está' : 'Vista lateral da passagem' }));
      li.append(el('p', { class: 'note', id: 'obsNote', text: '' }));
      queueMicrotask(bindMap);
    }
    li.append(field('Ambiente', chipGroup('env', Object.entries(ENVS).map(([k, v]) => ({ value: k, label: v.name })),
      environment, (v) => { setEnvironment(v); renderControls(); })));
    const mix = (id, label, key, max = 2) => slider(id, label, 0, max, 0.01, params[key], (v) => `${Math.round(v * 100)}%`,
      (v) => { params[key] = v; sendParams(); });
    li.append(mix('mxFan', prop ? 'Hélice e fan' : 'Fan', 'fan'), mix('mxCore', 'Núcleo (compressor, turbina, combustão)', 'core'), mix('mxJet', 'Jato', 'jet'), mix('mxVol', 'Volume', 'master', 1.5));
    controls.append(li);
    controls.scrollTop = scrollTop;
    paintDetents();
  }

  function setListener() {
    params.listener = observer === 'board' ? board : groundMode;
    sendParams();
    applyListenerAcoustics();
    renderControls();
  }

  function setObserver(v) {
    observer = v;
    setListener();
  }

  // ------------------------------------------------------------ presets
  // família em cima, aeronaves dela embaixo
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
    const list = el('div', { class: 'cars' });
    for (const p of PRESETS.filter((x) => x.family === family)) {
      const b = el('button', { type: 'button', class: 'preset', 'data-id': p.id, 'aria-pressed': String(p.id === presetId) },
        [el('b', { text: p.name }), el('small', { text: p.tag })]);
      b.addEventListener('click', () => loadPreset(p));
      list.append(b);
    }
    nav.append(fams, list);
  }
  function markPreset() {
    document.querySelectorAll('.preset').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === presetId)));
  }
  function loadPreset(p) {
    spec = { ...p };
    if (tla > 1 && !spec.ab) setTla(1);
    if (spec.mount === 'fuselage' && board === 'cabin') { board = 'cockpit'; params.listener = observer === 'board' ? board : groundMode; sendParams(); }
    pushConfig(true);
    presetId = p.id;
    markPreset();
    renderControls();
    paintLever();
  }

  function updatePlate() {
    const prop = spec.arch === 'turboprop';
    const parts = [ARCH[spec.arch], `${spec.engines}×`];
    if (prop) parts.push(`hélice ${spec.propB} pás`, `${fmt(spec.propRpm)} rpm`);
    else parts.push(`${spec.fanB} pás`, spec.bpr > 0.2 && spec.arch !== 'turbojet' ? `bypass ${fmt(spec.bpr, 1)}` : 'sem bypass');
    parts.push(`${fmt(spec.thrust)} kN${prop ? ' eq.' : ''}`);
    if (spec.ab && !prop) parts.push('pós-combustão');
    $('#plate').textContent = parts.join(' · ');
  }

  // ------------------------------------------------------------ manete
  const MAXT = 1.3;
  function paintLever() {
    const p = (tla / MAXT) * 100;
    $('#leverFill').style.height = `${p}%`;
    $('#leverKnob').style.bottom = `calc(10px + (100% - 20px) * ${tla / MAXT})`;
    $('#lever').setAttribute('aria-valuenow', String(Math.round(tla * 100)));
    paintDetents();
  }
  function paintDetents() {
    const marks = $('#leverMarks');
    if (!marks.childElementCount || marks.dataset.ab !== String(!!spec.ab)) {
      marks.textContent = '';
      marks.dataset.ab = String(!!spec.ab);
      const list = [[0, 'lenta'], [0.8, 'subida'], [1, 'deco']];
      if (spec.ab && spec.arch !== 'turboprop') list.push([1.3, 'pós']);
      for (const [v, label] of list) {
        const s = el('span', { text: label, class: v > 1 ? 'ab' : '' });
        s.style.bottom = `${(v / MAXT) * 100}%`;
        marks.append(s);
      }
    }
    const canAB = spec.ab && spec.arch !== 'turboprop';
    $('#abKey').disabled = !canAB;
    document.querySelectorAll('#detents [data-tla]').forEach((b) => b.classList.toggle('at', Math.abs(+b.dataset.tla - tla) < 0.01));
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

  // Mostrador redondo no estilo dos painéis de motor (EICAS)
  function dial(g, cx, cy, R, value, max, red, label, unit, digits, hot) {
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.0;
    const ang = (v) => a0 + (a1 - a0) * clamp(v / max, 0, 1.02);
    g.lineCap = 'butt';
    g.lineWidth = Math.max(3, R * 0.07);
    g.strokeStyle = C.raise;
    g.beginPath(); g.arc(cx, cy, R * 0.9, a0, a1); g.stroke();
    g.strokeStyle = C.violet;
    g.beginPath(); g.arc(cx, cy, R * 0.9, ang(red), a1); g.stroke();
    g.strokeStyle = hot ? C.hot : C.gold; g.globalAlpha = 0.85;
    g.beginPath(); g.arc(cx, cy, R * 0.9, a0, ang(value)); g.stroke(); g.globalAlpha = 1;
    // marcas
    g.lineWidth = 1;
    for (let i = 0; i <= 10; i++) {
      const v = (max * i) / 10, a = ang(v), major = i % 2 === 0;
      g.strokeStyle = v >= red ? C.violet : major ? C.ink : C.faint;
      const r1 = R * (major ? 0.72 : 0.76), r2 = R * 0.8;
      g.beginPath(); g.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1); g.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2); g.stroke();
    }
    // ponteiro
    const a = ang(value);
    g.strokeStyle = C.ink; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * R * 0.86, cy + Math.sin(a) * R * 0.86); g.stroke();
    g.fillStyle = C.ink; g.beginPath(); g.arc(cx, cy, Math.max(3, R * 0.05), 0, Math.PI * 2); g.fill();
    // leitura digital
    g.textAlign = 'right'; g.textBaseline = 'alphabetic';
    g.fillStyle = hot ? C.hot : C.ink;
    g.font = `800 ${Math.round(R * 0.36)}px ${C.display}`;
    g.fillText(fmt(value, digits), cx + R * 0.95, cy + R * 0.62);
    g.textAlign = 'left';
    g.font = `500 ${Math.max(9, Math.round(R * 0.09))}px ${C.mono}`;
    g.fillStyle = C.muted;
    g.fillText(`${label}${unit ? ' · ' + unit : ''}`, cx - R * 0.95, cy + R * 0.62);
  }

  function drawEicas() {
    const [g, w, h] = fit($('#eicas'));
    g.clearRect(0, 0, w, h);
    const prop = spec.arch === 'turboprop';
    // N1 grande à esquerda, EGT menor à direita, leituras digitais embaixo do EGT
    const narrow = w < 560;
    let big = narrow ? Math.min(w * 0.27, (h - 112) / 2.1) : Math.min(w * 0.3, h * 0.4), small = Math.min(w * 0.17, big * 0.68);
    const gap = w - 2 * big - 2 * small - 20;
    if (gap < 0) { const k = (w - 20) / (2 * big + 2 * small); big *= k; small *= k; }
    const cx1 = big + 6, cy1 = big + 8;
    const cx2 = w - small - 6, cy2 = small + 8;
    dial(g, cx1, cy1, big, prop ? tele.np || 0 : tele.n1 || 0, 110, 104, prop ? 'NP' : 'N1', '%', 1, false);
    dial(g, cx2, cy2, small, tele.egt || 0, 1100, 950, 'EGT', '°C', 0, (tele.ab || 0) > 0.1);
    const rows = [
      [prop ? 'NG' : 'N2', `${fmt(tele.n2 || 0, 1)} %`],
      // consumo específico típico: turbofan de bypass alto gasta bem menos por kN que turbojato
      ['Combustível', `${fmt((tele.ff || 0) * spec.thrust * (36 + 45 / (1 + (spec.bpr || 0))) * (1 + 1.6 * (tele.ab || 0)), 0)} kg/h`],
      ['Empuxo', `${fmt(Math.max(0, tele.thrust || 0), 0)} kN`],
    ];
    if (prop) rows.push(['Hélice', `${fmt(((tele.np || 0) / 100) * spec.propRpm, 0)} rpm`]);
    // em tela estreita as leituras vão para baixo dos dois mostradores, na largura toda
    const x0 = narrow ? 6 : Math.max(cx1 + big + 12, cx2 - small - 20), x1 = w - 6;
    const y0 = narrow ? cy1 + big * 0.75 + 18 : cy2 + small * 0.95 + 16;
    g.textBaseline = 'alphabetic';
    rows.forEach(([k, v], i) => {
      const y = y0 + i * 24;
      if (y > h - 4) return;
      g.textAlign = 'left'; g.font = `500 10px ${C.mono}`; g.fillStyle = C.muted; g.fillText(k.toUpperCase(), x0, y);
      g.textAlign = 'right'; g.font = `500 14px ${C.mono}`; g.fillStyle = C.ink; g.fillText(v, x1, y);
      g.strokeStyle = C.line; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, y + 7); g.lineTo(x1, y + 7); g.stroke();
    });
    // avisos
    const flags = [];
    if (tele.state === 'start') {
      if (tele.starter) flags.push(['MOTOR DE PARTIDA', C.gold]);
      flags.push(tele.lit ? ['CHAMA ACESA', C.hot] : tele.fuel ? ['COMBUSTÍVEL · IGNIÇÃO', C.gold] : ['GIRANDO A SECO', C.muted]);
    }
    if (tele.state === 'stop') flags.push(['CORTE', C.muted]);
    if ((tele.ab || 0) > 0.1) flags.push(['PÓS-COMBUSTÃO', C.hot]);
    if ((tele.rev || 0) > 0.1) flags.push(['REV', C.hot]);
    if ((tele.boomAge ?? 99) < 2) flags.push(['ESTRONDO SÔNICO', C.hot]);
    g.textAlign = 'center'; g.font = `600 ${Math.max(10, Math.round(big * 0.1))}px ${C.mono}`;
    flags.forEach(([t, col], i) => { g.fillStyle = col; g.fillText(t, cx1, cy1 - big * 0.32 + i * big * 0.13); });
  }

  // Face do fan girando na rotação real; acima de uns poucos giros por quadro vira borrão.
  let fanSweep = 0;
  function drawFan(now, dt) {
    const [g, w, h] = fit($('#fan'));
    g.clearRect(0, 0, w, h);
    const prop = spec.arch === 'turboprop';
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.42;
    const age = Math.min(0.05, Math.max(0, (now - (tele.t || now)) / 1000));
    const f = prop ? tele.fp || 0 : tele.f1 || 0;
    const ph = ((prop ? tele.phP : tele.ph) || 0) + f * age;
    const B = prop ? spec.propB : spec.fanB;
    fanSweep = f * dt; // voltas por quadro
    // carcaça e estator
    if (!prop) {
      g.strokeStyle = C.line; g.lineWidth = 1;
      g.beginPath(); g.arc(cx, cy, R * 1.04, 0, Math.PI * 2); g.stroke();
      g.strokeStyle = C.faint;
      for (let i = 0; i < spec.vanes; i++) {
        const a = (i / spec.vanes) * Math.PI * 2;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * R * 1.07, cy + Math.sin(a) * R * 1.07); g.lineTo(cx + Math.cos(a) * R * 1.14, cy + Math.sin(a) * R * 1.14); g.stroke();
      }
    }
    const tipCol = !prop && (tele.Mt || 0) > 1 ? C.hot : C.gold;
    const hub = prop ? 0.14 : 0.3;
    // borrão de movimento: desenha as pás em várias posições dentro do quadro
    const steps = clamp(Math.ceil(fanSweep * B * 3), 1, 18);
    const blur = fanSweep * B > 6;
    if (blur) {
      const grd = g.createRadialGradient(cx, cy, R * hub, cx, cy, R);
      grd.addColorStop(0, C.raise); grd.addColorStop(1, tipCol);
      g.fillStyle = grd; g.globalAlpha = 0.28;
      g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.arc(cx, cy, R * hub, 0, Math.PI * 2, true); g.fill();
      g.globalAlpha = 1;
    } else {
      for (let s = 0; s < steps; s++) {
        const p0 = ph - (fanSweep * s) / steps;
        g.globalAlpha = steps > 1 ? 0.9 / steps + 0.08 : 1;
        for (let b = 0; b < B; b++) {
          const a = (p0 + b / B) * Math.PI * 2 - Math.PI / 2;
          if (prop) {
            // pá de hélice: larga perto do cubo, afinando na ponta
            const pw = 0.09;
            g.fillStyle = C.ink;
            g.beginPath();
            g.moveTo(cx + Math.cos(a - pw) * R * 0.16, cy + Math.sin(a - pw) * R * 0.16);
            g.quadraticCurveTo(cx + Math.cos(a - pw * 0.7) * R * 0.6, cy + Math.sin(a - pw * 0.7) * R * 0.6, cx + Math.cos(a) * R, cy + Math.sin(a) * R);
            g.quadraticCurveTo(cx + Math.cos(a + pw * 0.4) * R * 0.6, cy + Math.sin(a + pw * 0.4) * R * 0.6, cx + Math.cos(a + pw) * R * 0.16, cy + Math.sin(a + pw) * R * 0.16);
            g.fill();
          } else {
            // pá de fan com torção: a ponta fica adiantada em relação à raiz
            const twist = 0.35;
            g.strokeStyle = C.ink; g.lineWidth = Math.max(1, (R * 2.2) / B);
            g.beginPath();
            g.moveTo(cx + Math.cos(a) * R * hub, cy + Math.sin(a) * R * hub);
            g.quadraticCurveTo(cx + Math.cos(a + twist * 0.3) * R * 0.65, cy + Math.sin(a + twist * 0.3) * R * 0.65, cx + Math.cos(a + twist) * R * 0.98, cy + Math.sin(a + twist) * R * 0.98);
            g.stroke();
            g.fillStyle = tipCol;
            g.beginPath(); g.arc(cx + Math.cos(a + twist) * R * 0.98, cy + Math.sin(a + twist) * R * 0.98, 1.6, 0, Math.PI * 2); g.fill();
          }
        }
      }
      g.globalAlpha = 1;
    }
    // cubo / spinner
    g.fillStyle = C.panel; g.strokeStyle = C.line; g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, R * hub, 0, Math.PI * 2); g.fill(); g.stroke();
    // marca no spinner para ver o giro mesmo com borrão
    const sa = ph * Math.PI * 2 - Math.PI / 2;
    g.strokeStyle = C.muted; g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(sa) * R * hub * 0.85, cy + Math.sin(sa) * R * hub * 0.85); g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = C.faint; g.font = `500 10px ${C.mono}`;
    if (R > 90) g.fillText(prop ? `${B} pás · tempo real` : `${B} pás · ${spec.vanes} palhetas · tempo real`, cx, cy + R * 1.24 > h - 6 ? h - 8 : cy + R * 1.24);
  }

  function renderReadout() {
    const prop = spec.arch === 'turboprop';
    const on = (tele.n2 || 0) > 1;
    if (prop) {
      $('#roFan').textContent = on ? `hélice ${fmt(((tele.np || 0) / 100) * spec.propRpm)} rpm · pás ${fmt((spec.propB * (tele.fp || 0)), 0)} Hz` : '—';
      $('#roTip').textContent = on ? `Mach ${fmt(tele.Mh || 0, 2)}` : '—';
      $('#roCut').textContent = 'hélice aberta: sem duto';
      $('#roCut').className = 'v mono';
    } else {
      $('#roFan').textContent = on ? `${fmt((tele.f1 || 0) * 60)} rpm · BPF ${fmt(tele.bpf || 0)} Hz` : '—';
      const Mt = tele.Mt || 0;
      $('#roTip').textContent = on ? `Mach ${fmt(Mt, 2)}${Mt > 1 ? ' · choques: buzz-saw' : ''}` : '—';
      $('#roTip').className = `v mono${Mt > 1 ? ' warn' : ''}`;
      const c = tele.cut1 || 0;
      $('#roCut').textContent = !on ? '—' : Mt > 1 ? 'propaga (ponta supersônica)' : c > 0.5 ? 'propaga pelo duto' : `cortado no duto (${fmt(20 * Math.log10(Math.max(c, 1e-6)), 0)} dB)`;
      $('#roCut').className = `v mono${on && c <= 0.5 && Mt <= 1 ? ' ok' : ''}`;
    }
    $('#roFan').previousElementSibling.textContent = prop ? 'Hélice' : 'Fan';
    $('#roCut').previousElementSibling.textContent = prop ? 'Duto' : 'Tom BPF';
    $('#roHpc').textContent = on ? `${fmt(tele.hpcF || 0)} Hz` : '—';
    const vj = tele.vj || 0, mj = tele.mj || 0;
    $('#roJet').textContent = on ? `${fmt(vj)} m/s · Mach ${fmt(mj, 2)}${tele.vb > 1 ? ` · bypass ${fmt(tele.vb)} m/s` : ''}${tele.crackle ? ' · crackle' : ''}` : '—';
    $('#roJet').className = `v mono${mj > 1 ? ' warn' : ''}`;
    const boom = (tele.boomAge ?? 99) < 4;
    $('#roSpl').textContent = boom ? `estrondo: ${fmt(tele.boomDb)} dB de pico` : tele.spl > 20 && audio ? `≈ ${fmt(tele.spl)} dB SPL` : '—';
    $('#roSpl').className = `v mono${boom || tele.spl > 120 ? ' warn' : ''}`;
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
    if (!audio) { g.fillText('dê a partida para ver a onda e o espectro', 10, h - 18); return; }
    const an = audio.analyser;
    if (!tBuf) { tBuf = new Float32Array(an.fftSize); fBuf = new Float32Array(an.frequencyBinCount); }
    an.getFloatTimeDomainData(tBuf);
    const sr = audio.ctx.sampleRate;
    const span = Math.min(tBuf.length, 2048);
    g.strokeStyle = C.gold; g.lineWidth = 1.2;
    g.beginPath();
    for (let i = 0; i < span; i++) {
      const x = (i / (span - 1)) * w;
      const y = mid - tBuf[tBuf.length - span + i] * mid * 0.9;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
    an.getFloatFrequencyData(fBuf);
    const top = h * 0.66, bot = h - 4, f0 = 20, f1 = 16000;
    const fx = (f) => (Math.log(f / f0) / Math.log(f1 / f0)) * w;
    g.beginPath(); g.moveTo(0, bot);
    for (let x = 0; x <= w; x += 2) {
      const f = f0 * Math.pow(f1 / f0, x / w);
      const bin = Math.round((f / (sr / 2)) * fBuf.length);
      const dbv = fBuf[Math.min(bin, fBuf.length - 1)];
      const y = bot - clamp((dbv + 110) / 90, 0, 1) * (bot - top + h * 0.28);
      g.lineTo(x, y);
    }
    g.lineTo(w, bot); g.closePath();
    g.fillStyle = C.blue; g.globalAlpha = 0.22; g.fill(); g.globalAlpha = 1;
    // marcadores das fontes
    const prop = spec.arch === 'turboprop';
    const marks = [];
    if ((tele.n2 || 0) > 5) {
      if (prop) marks.push([spec.propB * (tele.fp || 0), 'hélice', C.gold]);
      else marks.push([tele.bpf || 0, 'BPF', C.gold]);
      marks.push([tele.hpcF || 0, 'compressor', C.violet]);
      if ((tele.fJet || 0) > 20) marks.push([tele.fJet, 'jato', C.hot]);
      if ((tele.fShock || 0) > 0) marks.push([tele.fShock, 'choque', C.hot]);
    }
    let lastX = -1e9, row = 0;
    for (const [f, label, col] of marks.sort((a, b) => a[0] - b[0])) {
      if (!(f > f0 && f < f1)) continue;
      const x = fx(f);
      row = x - lastX < 70 ? row + 1 : 0; lastX = x;
      g.strokeStyle = col; g.setLineDash([3, 3]);
      g.beginPath(); g.moveTo(x, top - h * 0.28 + row * 12); g.lineTo(x, bot); g.stroke(); g.setLineDash([]);
      g.fillStyle = col; g.textAlign = x > w - 110 ? 'right' : 'left';
      g.fillText(`${label} ${fmt(f)} Hz`, x + (x > w - 110 ? -6 : 6), top - h * 0.26 + row * 12);
    }
    g.fillStyle = C.faint; g.textAlign = 'right';
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) g.fillText(f >= 1000 ? `${f / 1000}k` : String(f), fx(f) - 2, bot - 12);
  }

  // Mapa do observador: vista de cima (ao redor do motor) ou de lado (passagem).
  function mapGeom(w, h) {
    const span = Math.max(spec.span || 0, 1);
    const ox = w * 0.5, oy = h * 0.5;
    const maxR = Math.min(w, h) * 0.46;
    const rad = (d) => Math.sqrt(d / 300) * maxR;
    return { ox, oy, maxR, rad, span };
  }
  function drawMap() {
    const cv = document.getElementById('obsMap');
    if (!cv) return;
    const [g, w, h] = fit(cv);
    g.clearRect(0, 0, w, h);
    const note = document.getElementById('obsNote');
    g.font = `500 10px ${C.mono}`; g.textBaseline = 'middle';
    if (groundMode === 'ground') {
      const { ox, oy, rad } = mapGeom(w, h);
      // anéis de distância
      g.strokeStyle = C.line; g.lineWidth = 1; g.fillStyle = C.faint; g.textAlign = 'left';
      for (const d of [10, 50, 150, 300]) { g.beginPath(); g.arc(ox, oy, rad(d), 0, Math.PI * 2); g.stroke(); g.fillText(`${d} m`, ox + rad(d) + 3, oy - 6); }
      // lóbulos de diretividade: frente (fan) e trás (jato), proporcionais ao nível
      const lobe = (dirFn, col) => {
        g.beginPath();
        for (let a = 0; a <= 360; a += 4) {
          const th = a <= 180 ? a : 360 - a;
          const r = rad(150) * dirFn(th);
          const x = ox - Math.cos((a * Math.PI) / 180) * r, y = oy - Math.sin((a * Math.PI) / 180) * r;
          if (a) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.closePath(); g.fillStyle = col; g.globalAlpha = 0.14; g.fill(); g.globalAlpha = 0.6; g.strokeStyle = col; g.stroke(); g.globalAlpha = 1;
      };
      const tab = (t) => (th) => { const x = clamp(th / 30, 0, 5.999), i = x | 0; return Math.pow(10, (t[i] + (t[i + 1] - t[i]) * (x - i)) / 30); };
      lobe(tab([-6, -2, 0, -3, -10, -20, -26]), C.gold);
      lobe(tab([-24, -22, -18, -14, -8, 0, -6]), C.hot);
      // avião visto de cima, nariz para a esquerda (mesmo sentido do ângulo)
      g.strokeStyle = C.ink; g.lineWidth = 2;
      g.beginPath(); g.moveTo(ox - 16, oy); g.lineTo(ox + 18, oy); g.stroke();
      g.lineWidth = 1.5; g.beginPath(); g.moveTo(ox + 2, oy - 14); g.lineTo(ox - 2, oy); g.lineTo(ox + 2, oy + 14); g.stroke();
      g.fillStyle = C.gold; g.fillRect(ox - 4, oy - 6, 6, 4);
      g.fillStyle = C.muted; g.textAlign = 'center'; g.fillText('entrada', ox - rad(150) * 0.75, oy + 12); g.fillText('jato', ox + rad(150) * 0.8, oy + 12);
      // você
      const a = (params.angle * Math.PI) / 180, r = rad(params.dist);
      const px = ox - Math.cos(a) * r, py = oy - Math.sin(a) * r;
      g.fillStyle = C.ink; g.beginPath(); g.arc(px, py, 5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = C.bg; g.lineWidth = 2; g.stroke();
      g.fillStyle = C.ink; g.textAlign = 'center'; g.fillText('você', px, py - 12);
      if (note) {
        const where = params.angle < 35 ? 'na frente da entrada de ar: fan e compressor' : params.angle < 110 ? 'de lado: um pouco de tudo' : 'atrás: o jato domina';
        note.textContent = `${params.dist} m, ${params.angle}° · ${where}. Arraste no mapa para mudar.`;
      }
    } else {
      // vista lateral: chão embaixo, avião passando no alto
      const gy = h - 16, ox = w / 2;
      const span = 1600, sx = w / span;
      const alt = params.alt, sy = (gy - 14) / Math.max(250, alt * 1.25);
      g.strokeStyle = C.line; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, gy); g.lineTo(w, gy); g.stroke();
      g.fillStyle = C.ink; g.beginPath(); g.arc(ox, gy, 4, 0, Math.PI * 2); g.fill();
      g.fillStyle = C.muted; g.textAlign = 'center'; g.fillText('você', ox, gy + 9);
      const x = tele.flyX ?? -800, ay = gy - alt * sy;
      g.strokeStyle = C.faint; g.setLineDash([4, 6]);
      g.beginPath(); g.moveTo(0, ay); g.lineTo(w, ay); g.stroke(); g.setLineDash([]);
      const vis = Math.abs(x) < span / 2;
      const ax = ox + clamp(x, -span / 2, span / 2) * sx;
      g.fillStyle = C.gold;
      if (vis) {
        g.beginPath(); g.moveTo(ax + 12, ay); g.lineTo(ax - 10, ay - 4); g.lineTo(ax - 10, ay + 4); g.closePath(); g.fill();
        g.strokeStyle = C.hot; g.globalAlpha = 0.6; g.beginPath(); g.moveTo(ax - 12, ay); g.lineTo(ax - 40, ay); g.stroke(); g.globalAlpha = 1;
      } else {
        const dirn = x > 0 ? 1 : -1, ex = dirn > 0 ? w - 4 : 4;
        g.beginPath(); g.moveTo(ex, ay); g.lineTo(ex - dirn * 10, ay - 6); g.lineTo(ex - dirn * 10, ay + 6); g.fill();
      }
      g.fillStyle = C.faint; g.textAlign = 'left'; g.fillText(`${fmt(alt)} m`, 4, ay - 8);
      const v = params.speed / 3.6, M = v / 340;
      if (M > 1 && vis) {
        // cone de Mach: atrás do avião, abrindo com ângulo asen(1/M); onde toca o chão, estrondo
        const back = alt * Math.sqrt(M * M - 1);
        const gx = ox + (x - back) * sx;
        g.strokeStyle = C.hot; g.lineWidth = 1.2; g.globalAlpha = 0.8;
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(gx, gy); g.stroke();
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax - back * sx, ay - (gy - ay)); g.stroke();
        g.globalAlpha = 0.08; g.fillStyle = C.hot;
        // dentro do cone: tudo que fica atrás das duas linhas
        g.beginPath(); g.moveTo(ax, ay); g.lineTo(gx, gy); g.lineTo(Math.min(gx, 0), gy); g.lineTo(Math.min(ax - back * sx, 0), ay - (gy - ay)); g.lineTo(ax - back * sx, ay - (gy - ay)); g.closePath(); g.fill();
        g.globalAlpha = 1;
      }
      if ((tele.boomAge ?? 99) < 1.2) {
        g.fillStyle = C.hot; g.textAlign = 'center'; g.font = `600 12px ${C.mono}`;
        g.fillText('BUM!', ox, gy - 22);
      }
      if (note) {
        const r = Math.hypot(x, alt);
        if (M > 1) {
          const back = alt * Math.sqrt(M * M - 1);
          const toCone = x - back; // >0: o cone já passou por você
          note.textContent = toCone < 0
            ? `Mach ${fmt(M, 2)} · o cone de Mach está a ${fmt(-toCone)} m de você. Até ele chegar, silêncio total.`
            : `Mach ${fmt(M, 2)} · dentro do cone. Estrondo de ${fmt(tele.boomDb || 0)} dB; o ronco de quando ele vinha chega de trás para frente.`;
        } else {
          const cos = -x / Math.max(1, r);
          const pct = (1 / (1 - M * cos) - 1) * 100;
          note.textContent = `${fmt(r)} m · ${x < 0 ? 'chegando' : 'indo embora'} · Doppler ${pct > 0 ? '+' : ''}${fmt(pct, 1)}% · volta de 6 km. Passe de Mach 1 para ouvir o estrondo.`;
        }
      }
    }
  }

  function bindMap() {
    const cv = document.getElementById('obsMap');
    if (!cv || groundMode !== 'ground') return;
    const pick = (e) => {
      const r = cv.getBoundingClientRect();
      const { ox, oy, maxR } = mapGeom(r.width, r.height);
      const dx = e.clientX - r.left - ox, dy = e.clientY - r.top - oy;
      const d = clamp(Math.round(Math.pow(Math.hypot(dx, dy) / maxR, 2) * 300), 5, 300);
      const ang = clamp(Math.round((Math.atan2(Math.abs(dy), -dx) * 180) / Math.PI), 0, 180);
      params.angle = ang; params.dist = d; sendParams();
      const a = $('#angle'), di = $('#dist');
      if (a) { a.value = ang; a.dispatchEvent(new Event('input')); }
      if (di) { di.value = d; di.dispatchEvent(new Event('input')); }
    };
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pick(e); });
    cv.addEventListener('pointermove', (e) => { if (cv.hasPointerCapture(e.pointerId)) pick(e); });
  }

  let lastNow = 0;
  function frame(now) {
    const dt = lastNow ? Math.min(0.1, (now - lastNow) / 1000) : 0;
    lastNow = now;
    // manete segura: avança/recua enquanto a tecla estiver apertada
    if (held.up || held.down) setTla(tla + (held.up - held.down) * dt * 0.45);
    drawEicas();
    drawFan(now, dt);
    drawScope();
    drawMap();
    renderReadout();
    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------ entrada
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' && e.target.type === 'text') return;
    if (e.code === 'KeyW' || e.code === 'ArrowUp') { e.preventDefault(); held.up = 1; }
    else if (e.code === 'KeyS' || e.code === 'ArrowDown') { e.preventDefault(); held.down = 1; }
    else if (e.repeat) return;
    else if (e.code === 'Digit1') setTla(0);
    else if (e.code === 'Digit2') setTla(0.8);
    else if (e.code === 'Digit3') setTla(1);
    else if (e.code === 'Digit4') setTla(1.3);
    else if (e.code === 'KeyR') setReverser(!reverser);
    else if (e.code === 'KeyI') setRunning(!running);
    else if (e.code === 'KeyC') {
      if (observer === 'board') { const o = ['cabin', 'cockpit', 'wingcam']; board = o[(o.indexOf(board) + 1) % 3]; }
      else groundMode = groundMode === 'ground' ? 'flyby' : 'ground';
      setListener();
    } else if (e.code === 'KeyV') setObserver(observer === 'board' ? 'ground' : 'board');
  });
  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyW' || e.code === 'ArrowUp') held.up = 0;
    else if (e.code === 'KeyS' || e.code === 'ArrowDown') held.down = 0;
  });
  window.addEventListener('blur', () => { held.up = 0; held.down = 0; });

  const lever = $('#lever');
  const tlaFrom = (e) => { const r = lever.querySelector('.lever-track').getBoundingClientRect(); return clamp(1 - (e.clientY - r.top) / r.height, 0, 1) * MAXT; };
  lever.addEventListener('pointerdown', (e) => { lever.setPointerCapture(e.pointerId); setTla(tlaFrom(e)); });
  lever.addEventListener('pointermove', (e) => { if (lever.hasPointerCapture(e.pointerId)) setTla(tlaFrom(e)); });
  lever.addEventListener('keydown', (e) => {
    if (e.code === 'PageUp') setTla(tla + 0.1);
    else if (e.code === 'PageDown') setTla(tla - 0.1);
  });
  document.querySelectorAll('#detents [data-tla]').forEach((b) => b.addEventListener('click', () => setTla(+b.dataset.tla)));
  $('#revKey').addEventListener('click', () => setReverser(!reverser));
  $('#ignition').addEventListener('click', () => setRunning(!running));

  // ------------------------------------------------------------ início
  readColors();
  renderPresets();
  renderControls();
  updatePlate();
  paintLever();
  if (document.fonts) document.fonts.ready.then(readColors);
  requestAnimationFrame(frame);
})();
