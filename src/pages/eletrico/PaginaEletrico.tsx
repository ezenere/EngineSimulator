// Página do Elétrico (ELETRICO.md 6): carros, trens e metrôs, bondes e trólebus, ferramentas, drone e o motor industrial,
// com a Cena nova (CenaDSP com o portador do preset; ouvinte no gimbal preso ao corpo) no AudioWorklet. O React monta a
// estrutura; o estado e as mensagens ficam em ControleEletrico, e os mostradores são desenhados num só requestAnimationFrame
// lendo a telemetria de um campo.
import { memo, useEffect, useRef, useState } from 'react';
import { AudioShell, Barra, BotaoIgnicao, FamilyNav, PresetNav, PERFIL_PASSAGEM, useAudioShell } from '../../ui';
import { DSPEletricoPagina } from '../../engines/eletrico/pagina';
import { PRESETS_ELETRICO, FAMILIAS_ELETRICO } from '../../engines/eletrico/presets';
import { NOMES_NOTAS } from '../../engines/eletrico/constantes';
import urlEletrico from '../../worklet/processador-eletrico.ts?worker&url';
import { ControleEletrico, useTopico } from './controle';
import { Painel } from './Painel';
import { Medidor, Espectrograma, desenharEspectro, escreverLeituras, acenderTeclado, type Leituras } from './mostradores';

export function PaginaEletrico() {
  const [c] = useState(() => new ControleEletrico());
  return (
    <AudioShell perfil={PERFIL_PASSAGEM} moduloUrl={urlEletrico} processador="eletrico-engine" criarDspLocal={(fs) => new DSPEletricoPagina(fs)}
      ambiente="eletrico" medidor aoMensagem={c.onTelemetria}>
      <Conteudo c={c} />
    </AudioShell>
  );
}

// "Tesla Model 3 Long Range AWD · motor PMSRM de 6 polos · 54 ranhuras · inversor SiC 10 kHz · redução 9,06:1"
const MAQ: Record<string, string> = { pmsm: 'PMSM', pmsrm: 'PMSRM', inducao: 'de indução', 'sincrona-excitada': 'síncrono', 'cc-serie': 'CC série', universal: 'universal', bldc: 'BLDC' };
const TIPO_INV: Record<string, string> = { sic: 'SiC', igbt: 'IGBT', gto: 'GTO', mosfet: 'MOSFET' };
function placa(c: ControleEletrico) {
  const p = c.preset(), inv = p.inversor;
  const i = p.reducao.estagios.reduce((a, s) => (a * s.Zc) / s.Zp, 1);
  const invT = inv ? (inv.tipo === 'csi' ? 'inversor de corrente' : inv.tipo === 'chopper' ? `chopper de ${inv.fc} Hz` : `inversor ${TIPO_INV[inv.tipo] ?? inv.tipo.toUpperCase()} ${inv.fc >= 1000 ? `${(inv.fc / 1000).toLocaleString('pt-BR')} kHz` : `${inv.fc} Hz`}`) : p.fRede ? `rede de ${p.fRede} Hz` : 'sem inversor';
  const ranhuras = `${p.Zs} ranhuras${p.Zr ? ` (${p.Zr} no rotor)` : ''}${p.Zc ? ` · ${p.Zc} lâminas no comutador` : ''}`;
  const red = Math.abs(i - 1) < 1e-6 ? 'acionamento direto' : `redução ${i.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}:1`;
  return `${p.nome} · motor ${MAQ[p.maquina]} de ${2 * p.p} polos · ${ranhuras} · ${invT} · ${red}${c.presetId ? '' : ' · editado'}`;
}

function Conteudo({ c }: { c: ControleEletrico }) {
  const { iniciar, estado, erro } = useAudioShell();
  c.iniciar = iniciar;
  const cvE = useRef<HTMLCanvasElement>(null), cvS = useRef<HTMLCanvasElement>(null), teclado = useRef<HTMLDivElement>(null);
  const leituras = useRef<Leituras>({});

  useEffect(() => {
    const med = new Medidor(), esp = new Espectrograma();
    window.addEventListener('keydown', c.keydown);
    window.addEventListener('keyup', c.keyup);
    (window as unknown as { __eletrico: unknown }).__eletrico = { c, med };
    let id = 0;
    const frame = (agora: number) => {
      const novo = med.medir(c);
      escreverLeituras(c, med, leituras.current);
      acenderTeclado(c, teclado.current);
      if (cvE.current) desenharEspectro(c, med, cvE.current);
      if (cvS.current) esp.desenhar(c, med, cvS.current, agora, novo);
      id = requestAnimationFrame(frame);
    };
    id = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(id); window.removeEventListener('keydown', c.keydown); window.removeEventListener('keyup', c.keyup); };
  }, [c]);

  return (
    <div className="app eletrico" data-audio={estado} data-erro={erro ? String(erro) : undefined}>
      <Barra logo="Elétrico" placa={<Placa c={c} />}><Ignicao c={c} /></Barra>
      <Presets c={c} />
      <main className="palco">
        <Instrumentos c={c} leituras={leituras} teclado={teclado} />
        <section className="graficos" aria-label="Espectro e espectrograma">
          <figure className="grafico">
            <figcaption className="legenda">Espectro de 20 Hz a 12 kHz, com o nome de cada linha</figcaption>
            <div className="quadro"><canvas id="espectro" ref={cvE} role="img" aria-label="Espectro do som com as linhas do motor, do inversor e da redução anotadas" /></div>
          </figure>
          <figure className="grafico">
            <figcaption className="legenda">Espectrograma dos últimos 10 s</figcaption>
            <div className="quadro"><canvas id="espectrograma" ref={cvS} role="img" aria-label="Espectrograma rolante dos últimos 10 segundos" /></div>
          </figure>
        </section>
        <p className="hints"><kbd>Espaço</kbd> liga e desliga · <kbd>↑</kbd>/<kbd>↓</kbd> acelerador · <kbd>R</kbd> regeneração (segure) · <kbd>M</kbd> modo de modulação</p>
      </main>
      <Painel c={c} />
    </div>
  );
}

function Placa({ c }: { c: ControleEletrico }) { useTopico(c, 'presets', 'painel'); return <span id="plate">{placa(c)}</span>; }

function Ignicao({ c }: { c: ControleEletrico }) {
  useTopico(c, 'estado');
  return <BotaoIgnicao id="ignicao" ligado={c.ign} rotulo={c.erro ? `Erro no áudio: ${c.erro}` : c.ign ? 'Desligar' : 'Ligar motor'} estado={c.erro ? 'erro' : undefined}
    aoClicar={() => { c.ligar().catch((e) => console.error('Elétrico: áudio não iniciou', e)); }} />;
}

function Presets({ c }: { c: ControleEletrico }) {
  useTopico(c, 'presets');
  return (
    <nav className="presets" id="presets" aria-label="Motores prontos">
      <FamilyNav familias={FAMILIAS_ELETRICO} presets={PRESETS_ELETRICO} atual={c.familia} aoEscolher={(id) => c.setFamilia(id)} />
      <PresetNav presets={PRESETS_ELETRICO} familia={c.familia} atual={c.presetId || null} aoEscolher={(p) => c.carregarPreset(p)} />
    </nav>
  );
}

const Instrumentos = memo(function Instrumentos({ c, leituras, teclado }: { c: ControleEletrico; leituras: { current: Leituras }; teclado: { current: HTMLDivElement | null } }) {
  useTopico(c, 'presets');
  const linha = (k: string, id: string, grande = false, dica?: string) => (
    <div className={`ro-row${grande ? ' grande' : ''}`} title={dica}><span className="k">{k}</span><span className="v mono" id={`ro-${id}`} ref={(e) => { if (e) leituras.current[id] = e; }}>—</span></div>
  );
  const escada = !!c.base.inversor?.escada;
  return (
    <section className="instrumentos readout" aria-label="Mostradores">
      {linha('Rotação', 'rpm', true)}
      {linha('Velocidade', 'v', true)}
      {linha('No ouvido', 'nivel', true)}
      {linha('Freq. elétrica', 'fe', false, 'Frequência da corrente do motor (f_e) e a rotação do eixo em voltas por segundo')}
      {linha('Portadora', 'fc', false, 'Frequência de chaveamento do inversor (f_c); no modo síncrono, quantos pulsos por ciclo')}
      {linha('Modulação', 'modo', false, 'Como o inversor desenha a tensão: é o que dá as “marchas” e o do-re-mi')}
      {linha('Corrente', 'corrente', false, 'Corrente em relação à nominal e o torque no eixo (negativos na regeneração)')}
      {linha('Potência', 'potencia')}
      {linha('Tensão e fluxo', 'mfluxo', false, 'Índice de modulação (quanto da tensão o inversor usa) e fluxo do motor')}
      {linha('Som de aviso', 'avas', false, 'AVAS: o som que o carro elétrico emite em baixa velocidade')}
      <figure className="escada" hidden={!escada}>
        <figcaption className="legenda">Escada do inversor: o do-re-mi</figcaption>
        <div className="teclado" id="teclado" ref={teclado} hidden={!escada} role="img" aria-label="Teclado com as notas da escada do inversor; a nota de agora fica acesa">
          {NOMES_NOTAS.map((n, i) => <span key={n} className="tecla" data-i={i}>{n}</span>)}
          <span className="tecla patamar" data-i={12} title="Patamar: a portadora para em 598 Hz">598</span>
        </div>
      </figure>
    </section>
  );
});
