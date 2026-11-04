// Seções de aviação comuns às páginas do Ronco (família aviação) e do Radial (RADIAL.md 7.1 e 7.2): magnetos e mistura,
// partida, hélice (manete de passo) e rotor (coletivo, embreagem). Cada controle chama `aoMudar` com o pedaço do estado;
// a página manda `{ type: 'av', … }` ao DSP. As leituras que mudam a cada quadro têm ids e são escritas pelo laço dos
// mostradores (src/pages/comum/aviacao-leituras.ts), fora do React.
import { ChipGroup, Field, Section, Slider } from '../../ui';

export type EstadoAv = { magnetos: string; mistura: number; rpmAlvo: number; coletivo: number; engatar: boolean; prime: number; blower: 'baixa' | 'alta' };
export const AV_PADRAO: EstadoAv = { magnetos: 'ambos', mistura: 0.8, rpmAlvo: 1, coletivo: 0, engatar: false, prime: 0, blower: 'baixa' };

const pct = (v: number) => `${Math.round(v * 100)}%`;
const marcaMistura = (v: number) => (v < 0.05 ? 'corte' : v < 0.45 ? 'pobre demais' : v < 0.7 ? 'pobre' : v < 0.9 ? 'auto-rica' : 'rica');
const linha = (id: string, k: string) => <div className="ro-row" key={id}><span className="k">{k}</span><span className="v mono" id={id}>—</span></div>;

export const MAGNETOS = [
  { valor: 'desligado', rotulo: 'OFF' }, { valor: 'esq', rotulo: 'ESQ' }, { valor: 'dir', rotulo: 'DIR' }, { valor: 'ambos', rotulo: 'AMBOS' },
];
export const proximoMagneto = (m: string) => MAGNETOS[(MAGNETOS.findIndex((x) => x.valor === m) + 1) % MAGNETOS.length].valor;

export function MagnetosEMistura({ av, aoMudar, duasVelocidades }: { av: EstadoAv; aoMudar: (p: Partial<EstadoAv>) => void; duasVelocidades?: boolean }) {
  return (
    <Section titulo="Magnetos e mistura">
      <Field rotulo="Magnetos (tecla M)">
        <ChipGroup id="magnetos" opcoes={MAGNETOS} atual={av.magnetos} aoEscolher={(v) => aoMudar({ magnetos: v })} />
      </Field>
      <p className="note">Com um magneto só cada cilindro tem uma vela: a queima fica 20% mais lenta e o giro cai 40–120 rpm (o "mag check" a 1 700 rpm). OFF corta a ignição.</p>
      <Slider id="mistura" rotulo={`Mistura (teclas [ e ]) · ${marcaMistura(av.mistura)}`} min={0} max={1} passo={0.01} valor={av.mistura} formatar={pct} aoMudar={(v) => aoMudar({ mistura: v })} />
      <p className="note">Corte de lenta (0) é como se desliga um motor de avião: ele para em poucos segundos com a hélice girando. Pobre (55–65%) esquenta o escape e perde 3–7%; auto-rica (80%) é o ponto de potência; rica (100%) perde 8% e esfria.</p>
      {duasVelocidades && (
        <Field rotulo="Superalimentador">
          <ChipGroup id="blower" opcoes={[{ valor: 'baixa', rotulo: 'Baixa (7,6:1)' }, { valor: 'alta', rotulo: 'Alta (9,5:1)' }]} atual={av.blower} aoEscolher={(v) => aoMudar({ blower: v as 'baixa' | 'alta' })} />
        </Field>
      )}
      <div className="readout">{[linha('avMag', 'Mag check'), linha('avEgt', 'Gás de escape'), linha('avFumaca', 'Fumaça')]}</div>
    </Section>
  );
}

export function PartidaAv({ tipo, av, aoMudar, comPrime }: { tipo: string; av: EstadoAv; aoMudar: (p: Partial<EstadoAv>) => void; comPrime?: boolean }) {
  const nota: Record<string, string> = {
    inercia: 'Arranque de inércia: ENERGIZAR acelera o volante (o apito sobe de 290 a 390 Hz em ~18 s); ENGATAR entrega a energia ao motor, que gira a 60–100 rpm. Os magnetos ligam na 9ª pá (ou com a tecla I).',
    direta: 'Arranque elétrico direto: gira o motor a 80–120 rpm; os magnetos ligam na 9ª pá contada (limpa o óleo dos cilindros de baixo).',
    ar: 'Partida a ar comprimido (M-14P): o distribuidor manda ar a 50 bar a cada cilindro depois do ponto morto, um "tchuf" por cilindro; os magnetos já estão ligados.',
    manivela: 'Empurrar: a moto anda a 2 m/s e o motor pega com a roda.',
  };
  return (
    <Section titulo="Partida">
      <p className="note">{nota[tipo] ?? nota.direta}</p>
      {comPrime && (
        <Field rotulo="Primer (bombadas)">
          <ChipGroup id="prime" classe="num" opcoes={[0, 1, 2, 3].map((n) => ({ valor: n, rotulo: String(n) }))} atual={av.prime} aoEscolher={(n) => aoMudar({ prime: n })} />
        </Field>
      )}
      <div className="readout">{[linha('avFase', 'Fase'), linha('avPas', 'Pás contadas'), linha('avApito', 'Apito do volante'), linha('avEnch', 'Encharque')]}</div>
    </Section>
  );
}

export function HeliceAv({ passoFixo, av, aoMudar }: { passoFixo: boolean; av: EstadoAv; aoMudar: (p: Partial<EstadoAv>) => void }) {
  return (
    <Section titulo="Hélice">
      {passoFixo
        ? <p className="note">Passo fixo: a rotação é a que a hélice deixa (parado, uns 90% da máxima com o acelerador todo).</p>
        : <Slider id="rpmAlvo" rotulo="Manete de passo (rpm da hélice)" min={0} max={1} passo={0.01} valor={av.rpmAlvo} formatar={pct} aoMudar={(v) => aoMudar({ rpmAlvo: v })} />}
      <div className="readout">{[linha('avHel', 'Rotação da hélice'), linha('avBpf', 'Passagem de pá'), linha('avMach', 'Mach na ponta'), linha('avBeta', 'Passo'), linha('avCarga', 'Torque da hélice')]}</div>
    </Section>
  );
}

export function RotorAv({ av, aoMudar }: { av: EstadoAv; aoMudar: (p: Partial<EstadoAv>) => void }) {
  return (
    <Section titulo="Rotor">
      <Field rotulo="Embreagem do rotor">
        <ChipGroup id="engatar" opcoes={[{ valor: false, rotulo: 'Solta (só o motor)' }, { valor: true, rotulo: 'Engatada (governador)' }]} atual={av.engatar} aoEscolher={(v) => aoMudar({ engatar: v })} />
      </Field>
      <Slider id="coletivo" rotulo="Coletivo" min={0} max={1} passo={0.01} valor={av.coletivo} formatar={pct} aoMudar={(v) => aoMudar({ coletivo: v })} />
      <p className="note">Engatada, a correia leva o rotor em ~8 s e o governador abre a borboleta até o Nr nominal; o coletivo pede potência e o governador segura o giro.</p>
      <div className="readout">{[linha('avNr', 'Rotor (Nr)'), linha('avBpf', 'Passagem de pá'), linha('avCarga', 'Torque do rotor')]}</div>
    </Section>
  );
}

/** escreve as leituras de aviação no DOM a partir da telemetria (chamado a cada quadro pelos mostradores) */
export function escreverLeiturasAv(t: Record<string, any>) {
  const set = (id: string, v: string) => { const el = document.getElementById(id); if (el && el.textContent !== v) el.textContent = v; };
  const n0 = (x: number) => Math.round(x).toLocaleString('pt-BR');
  const n1 = (x: number) => x.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  if (t.rpmHelice !== undefined) set('avHel', `${n0(t.rpmHelice)} rpm`);
  if (t.bpf !== undefined) set('avBpf', `${n1(t.bpf)} Hz`);
  if (t.machPonta !== undefined) set('avMach', t.machPonta.toFixed(2).replace('.', ','));
  if (t.beta !== undefined) set('avBeta', `${n1((t.beta * 180) / Math.PI)}°`);
  if (t.torqueCarga !== undefined) set('avCarga', `${n0(t.torqueCarga)} N·m`);
  if (t.Nr !== undefined) set('avNr', `${n0(t.Nr)} rpm${t.nrPct ? ` · ${n0(t.nrPct)}%` : ''}${t.engate !== undefined && t.engate < 1 ? ` · engate ${n0(100 * t.engate)}%` : ''}`);
  if (t.egt !== undefined) set('avEgt', `${n0(t.egt)} °C`);
  if (t.fumaca !== undefined) set('avFumaca', `${n0(100 * t.fumaca)}%`);
  if (t.fase !== undefined) set('avFase', { parado: 'parado', energizar: 'energizando', girar: 'girando', pegou: 'funcionando' }[t.fase as string] ?? t.fase);
  if (t.pas !== undefined) set('avPas', n1(t.pas));
  if (t.apito !== undefined) set('avApito', t.apito ? `${n0(t.apito)} Hz` : '—');
  if (t.encharque) set('avEnch', (t.encharque as number[]).map((x) => (x > 0.05 ? x.toFixed(1) : '·')).join(' '));
  set('avMag', t.magnetos === 'ambos' ? 'ambos' : t.magnetos === 'desligado' ? 'desligados' : `só ${t.magnetos === 'esq' ? 'o esquerdo' : 'o direito'} · ${n0(t.rpm)} rpm`);
}
