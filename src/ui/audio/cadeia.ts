// Cadeia de áudio das páginas de motor (initAudio() de src/app.js e src/jet-app.js), sem React:
//
//   AudioWorklet (DSP, 4 canais)
//     ├─ canais 0–1: som direto ──────────────────────────────────→ seco ─┐
//     └─ canais 2–3: envio → Convolver (resposta do ambiente) → passa-baixa → molhado ─┤
//                                                                          ↓
//                      Compressor → EQ de 3 bandas (opcional) → saída → Analyser → destino
//
// Se o AudioWorklet não carregar, o mesmo DSP roda na thread principal num ScriptProcessorNode.
import { gerarRespostaAoImpulso } from './ambientes';
import { gerarRespostaPorBanda } from '../../scene/ambientes';
import type { Ambiente as AmbienteCena } from '../../scene/tipos';
import type { PerfilDeAudio } from './perfis';
import type { FabricaDeDSP } from '../../worklet/tipos';

export type OpcoesDaCadeia = {
  perfil: PerfilDeAudio;
  moduloUrl: string; // URL do bundle do worklet (import ... from './processador-x.ts?worker&url')
  processador: string; // nome passado a registerProcessor
  criarDspLocal?: FabricaDeDSP; // reserva para navegadores sem AudioWorklet
  aoMensagem?: (m: any) => void; // telemetria que o DSP manda por post()
  ambiente: string;
  ouvinte?: string; // posição inicial do ouvinte (params.listener)
  // analisador na soma seco + molhado, antes do compressor (o nível no ouvido da Passagem, em escala absoluta)
  medidor?: boolean;
};

export type Equalizacao = { lo: number; mid: number; hi: number };

export class CadeiaDeAudio {
  ctx: AudioContext;
  node: AudioNode;
  modo: 'worklet' | 'script';
  send: (m: any) => void;
  dry: GainNode;
  wet: GainNode;
  wetLP: BiquadFilterNode;
  conv: ConvolverNode;
  comp: DynamicsCompressorNode;
  analyser: AnalyserNode;
  medidor: AnalyserNode | null = null;
  eq: { lo: BiquadFilterNode; mid: BiquadFilterNode; hi: BiquadFilterNode } | null;
  perfil: PerfilDeAudio;
  ambiente: string;
  ouvinte = '';
  erroWorklet: unknown = null;

  private constructor() {}

  static async criar(o: OpcoesDaCadeia): Promise<CadeiaDeAudio> {
    const c = new CadeiaDeAudio();
    const P = o.perfil;
    c.perfil = P;
    c.ambiente = o.ambiente;
    c.ouvinte = o.ouvinte ?? '';
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const ctx: AudioContext = new AC({ latencyHint: 'interactive' });
    c.ctx = ctx;
    const aoMensagem = (m: any) => o.aoMensagem?.(m);
    try {
      if (!ctx.audioWorklet) throw new Error('AudioWorklet indisponível');
      await ctx.audioWorklet.addModule(o.moduloUrl);
      const node = new AudioWorkletNode(ctx, o.processador, { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [4] });
      node.port.onmessage = (e) => aoMensagem(e.data);
      c.node = node;
      c.send = (m) => node.port.postMessage(m);
      c.modo = 'worklet';
    } catch (err) {
      if (!o.criarDspLocal) throw err;
      // navegadores sem AudioWorklet (ou bloqueado): mesmo DSP na thread principal
      c.erroWorklet = err;
      const d = o.criarDspLocal(ctx.sampleRate);
      d.post = aoMensagem;
      const node = ctx.createScriptProcessor(1024, 0, 4);
      node.onaudioprocess = (e) => { const b = e.outputBuffer; d.process(b.getChannelData(0), b.getChannelData(1), b.length, b.getChannelData(2), b.getChannelData(3)); };
      c.node = node;
      c.send = (m) => d.message(m);
      c.modo = 'script';
    }
    // canais 0-1: som direto · canais 2-3: envio para a acústica do ambiente
    const node = c.node;
    node.channelInterpretation = 'discrete';
    const split = ctx.createChannelSplitter(4);
    const toDry = ctx.createChannelMerger(2), toWet = ctx.createChannelMerger(2);
    node.connect(split);
    split.connect(toDry, 0, 0); split.connect(toDry, 1, 1);
    split.connect(toWet, 2, 0); split.connect(toWet, 3, 1);
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const conv = ctx.createConvolver();
    const wetLP = ctx.createBiquadFilter(); wetLP.type = 'lowpass'; wetLP.frequency.value = P.corteInicial;
    const comp = ctx.createDynamicsCompressor();
    const K = P.compressor;
    comp.threshold.value = K.threshold; comp.knee.value = K.knee; comp.ratio.value = K.ratio; comp.attack.value = K.attack; comp.release.value = K.release;
    const out = ctx.createGain(); out.gain.value = P.saida;
    const analyser = ctx.createAnalyser(); analyser.fftSize = P.fft; analyser.smoothingTimeConstant = 0.6;
    toDry.connect(dry); toWet.connect(conv); conv.connect(wetLP); wetLP.connect(wet);
    if (o.medidor) {
      // soma seco + molhado num ganho unitário: dali vão o compressor e o medidor
      const soma = ctx.createGain();
      dry.connect(soma); wet.connect(soma); soma.connect(comp);
      const med = ctx.createAnalyser(); med.fftSize = 8192; med.smoothingTimeConstant = 0;
      soma.connect(med);
      c.medidor = med;
    } else {
      dry.connect(comp); wet.connect(comp);
    }
    if (P.eq) {
      // equalizador de escuta (grave / médio / agudo), para acertar o balanço no seu alto-falante
      const eqLo = ctx.createBiquadFilter(); eqLo.type = 'lowshelf'; eqLo.frequency.value = 160;
      const eqMid = ctx.createBiquadFilter(); eqMid.type = 'peaking'; eqMid.frequency.value = 900; eqMid.Q.value = 0.8;
      const eqHi = ctx.createBiquadFilter(); eqHi.type = 'highshelf'; eqHi.frequency.value = 3500;
      comp.connect(eqLo); eqLo.connect(eqMid); eqMid.connect(eqHi); eqHi.connect(out);
      c.eq = { lo: eqLo, mid: eqMid, hi: eqHi };
    } else {
      comp.connect(out);
      c.eq = null;
    }
    out.connect(analyser); analyser.connect(ctx.destination);
    Object.assign(c, { dry, wet, wetLP, conv, comp, analyser });
    if (P.ambientes[o.ambiente]) c.setAmbiente(o.ambiente);
    return c;
  }

  /**
   * Reverberação da Passagem (CENA.md 2.10): resposta ao impulso com RT60 por banda de
   * `gerarRespostaPorBanda`, que sai com energia 1 por canal. Por isso o convolver não normaliza
   * (`normalize = false`) e o ganho do molhado vem do ambiente: `reverb.wet` é a razão de POTÊNCIA entre o
   * campo reverberante e o envio, então o ganho de amplitude é √wet (como no render offline de
   * tools/cena/render-passagem.ts). O seco fica em `reverb.dry` e o passa-baixa do envio aberto (o
   * escurecimento já está no RT60 por banda). As respostas ficam guardadas por ambiente.
   */
  private respostas = new Map<string, AudioBuffer>();
  aplicarRespostaPorBanda(amb: AmbienteCena) {
    const ctx = this.ctx, sr = ctx.sampleRate;
    const chave = JSON.stringify([amb.id, amb.solo.tipo, amb.reverb]);
    let buf = this.respostas.get(chave);
    if (!buf) {
      const ir = gerarRespostaPorBanda(amb, sr);
      buf = ctx.createBuffer(2, ir.L.length, sr);
      buf.getChannelData(0).set(ir.L); buf.getChannelData(1).set(ir.R);
      if (this.respostas.size > 12) this.respostas.clear();
      this.respostas.set(chave, buf);
    }
    this.ambiente = amb.id;
    this.conv.normalize = false;
    this.conv.buffer = buf;
    const t = ctx.currentTime;
    this.wetLP.frequency.setTargetAtTime(20000, t, 0.05);
    this.wet.gain.setTargetAtTime(Math.sqrt(Math.max(0, amb.reverb.wet)), t, 0.05);
    this.dry.gain.setTargetAtTime(amb.reverb.dry ?? 1, t, 0.05);
  }

  // troca a resposta ao impulso do ambiente (setEnvironment); os params do DSP ficam com a página
  setAmbiente(kind: string) {
    this.ambiente = kind;
    this.conv.buffer = gerarRespostaAoImpulso(this.ctx, this.perfil.ambientes[kind]);
    this.aplicarOuvinte(this.ouvinte);
  }

  // setEnvironment(): manda os params do DSP (ex.: env novo) e depois troca a resposta ao impulso
  setAmbienteEParams(kind: string, params: unknown) {
    this.send({ type: 'params', params });
    this.setAmbiente(kind);
  }

  // applyListenerAcoustics: corte e ganho do ambiente conforme onde está o ouvinte
  aplicarOuvinte(ouvinte: string) {
    this.ouvinte = ouvinte;
    const t = this.ctx.currentTime;
    const a = this.perfil.acustica(ouvinte, this.perfil.ambientes[this.ambiente]);
    this.wetLP.frequency.setTargetAtTime(a.corte, t, 0.05);
    this.wet.gain.setTargetAtTime(a.molhado, t, 0.05);
    if (a.seco != null) this.dry.gain.setTargetAtTime(a.seco, t, 0.05);
  }

  // applyEq (dB)
  aplicarEq(eq: Equalizacao) {
    if (!this.eq) return;
    const t = this.ctx.currentTime;
    this.eq.lo.gain.setTargetAtTime(eq.lo, t, 0.03); this.eq.mid.gain.setTargetAtTime(eq.mid, t, 0.03); this.eq.hi.gain.setTargetAtTime(eq.hi, t, 0.03);
  }

  async retomar() {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }
}
