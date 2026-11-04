// Prova do pipeline do AudioWorklet: botão que liga um tom, frequência e volume por mensagem,
// ambiente (reverberação da cadeia) e o que volta do worklet (telemetria e nível na saída).
import { useEffect, useRef, useState, type RefObject } from 'react';
import { ChipGroup, Field, Section, Slider, useAudioShell, type Ambiente } from '../../ui';

const hz = (v: number) => `${Math.round(v).toLocaleString('pt-BR')} Hz`;
const pct = (v: number) => `${Math.round(v * 100)}%`;

export function ProvaDoWorklet({ ambientes, telemetria }: {
  ambientes: Record<string, Ambiente>;
  telemetria: RefObject<{ f: number; amp: number; t: number } | null>;
}) {
  const { iniciar, audio, estado, erro } = useAudioShell();
  const [ligado, setLigado] = useState(false);
  const [f, setF] = useState(220);
  const [amp, setAmp] = useState(0.2);
  const [amb, setAmb] = useState(Object.keys(ambientes)[0]);
  const [leitura, setLeitura] = useState({ f: 0, t: 0, rms: -Infinity });

  async function alternar() {
    const a = await iniciar();
    const on = !ligado;
    a.send({ type: 'tom', ligado: on, f, amp });
    setLigado(on);
  }

  // leitura a ~10 Hz: telemetria do worklet e nível RMS na saída do analisador
  const buf = useRef<Float32Array | null>(null);
  useEffect(() => {
    if (!audio) return;
    const id = setInterval(() => {
      const an = audio.analyser;
      if (!buf.current || buf.current.length !== an.fftSize) buf.current = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(buf.current as Float32Array<ArrayBuffer>);
      let s = 0;
      for (const x of buf.current) s += x * x;
      const rms = 10 * Math.log10(s / buf.current.length + 1e-20);
      const t = telemetria.current;
      setLeitura({ f: t?.f ?? 0, t: t?.t ?? 0, rms });
    }, 100);
    return () => clearInterval(id);
  }, [audio, telemetria]);

  return (
    <Section titulo="Prova do AudioWorklet">
      <p className="note">Um tom gerado por um processador em TypeScript, compilado pelo Vite num bundle próprio, passando pela cadeia de áudio completa (compressor, equalização, ambiente, analisador).</p>
      <div className="chips">
        <button id="provaTom" type="button" className="ignition" aria-pressed={ligado} onClick={alternar} disabled={estado === 'carregando'}>
          <span className="dot" /><span>{ligado ? 'Parar tom' : 'Tocar tom'}</span>
        </button>
      </div>
      <Slider id="provaF" rotulo="Frequência" min={55} max={880} passo={1} valor={f} formatar={hz}
        aoMudar={(v) => { setF(v); audio?.send({ type: 'tom', f: v }); }} />
      <Slider id="provaAmp" rotulo="Volume" min={0} max={0.5} passo={0.01} valor={amp} formatar={pct}
        aoMudar={(v) => { setAmp(v); audio?.send({ type: 'tom', amp: v }); }} />
      <Field rotulo="Ambiente">
        <ChipGroup id="provaAmb" opcoes={Object.entries(ambientes).map(([k, v]) => ({ valor: k, rotulo: v.name }))} atual={amb}
          aoEscolher={(k) => { setAmb(k); audio?.setAmbiente(k); }} />
      </Field>
      <div className="status" id="provaStatus" data-estado={estado} data-modo={audio?.modo ?? ''} data-f={leitura.f.toFixed(1)} data-rms={leitura.rms.toFixed(1)}>
        <div className="ro-row"><span className="k">Áudio</span><span className="v mono">{estado}{audio ? ` · ${audio.modo} · ${audio.ctx.sampleRate} Hz` : ''}</span></div>
        <div className="ro-row"><span className="k">Worklet</span><span className="v mono">{audio ? `${leitura.f.toFixed(1)} Hz · ${leitura.t.toFixed(1)} s` : '—'}</span></div>
        <div className="ro-row"><span className="k">Saída</span><span className="v mono">{audio && Number.isFinite(leitura.rms) ? `${leitura.rms.toFixed(1)} dBFS` : '—'}</span></div>
        {estado === 'erro' && <p className="note warn">Falhou: {String(erro)}</p>}
      </div>
    </Section>
  );
}
