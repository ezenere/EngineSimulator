// O bloco de condução do palco do Vapor: a linha de estado (em que pé a máquina está e o que fazer), a alavanca do
// regulador (fica onde foi deixada; W/S movem a mesma), o sentido de marcha com o corte automático (ou a reversão à
// mão), o apito e o freio de segurar, e os botões menores (sino, areia, torneiras). O trator ganha a marcha; a
// estacionária, a carga do eixo. Embaixo do palco, as demonstrações (os roteiros prontos).
import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ChipGroup, Field, Slider } from '../../ui';
import { CENARIOS, clamp, corteDeRev, temAreia, temFreio, temSino, temTorneiras, type ControleVapor, type EstadoVapor } from './controle';
import { SENTIDOS } from './maquinista';

const pct = (v: number) => `${Math.round(v * 100)}%`;
type P = { k: ControleVapor; e: EstadoVapor };

/** onde os mostradores escrevem a linha de estado e o corte do automático (fora do React, a cada quadro) */
export interface RefsConducao { titulo?: HTMLElement; detalhe?: HTMLElement; caixa?: HTMLElement; corte?: HTMLElement }

/**
 * Botão de segurar (apito, freio, areia): soa enquanto o dedo ou o botão do mouse estiver em cima. Solta ao levantar, ao
 * sair de cima (o ponteiro ou o dedo que escorrega: o toque prende o ponteiro no botão logo depois do pointerdown, e com
 * a captura o navegador nunca manda o pointerleave; ela é desfeita quando chega, e o pointermove fora do botão também
 * solta), ao cancelar o toque (rolagem, gesto do sistema), ao soltar em qualquer lugar da janela e quando a janela perde
 * o foco ou a aba some. Enter seguro também segura (teclado).
 */
export function BotaoDeSegurar({ id, ativo, aoMudar, classe, titulo, desabilitado, children }: {
  id: string; ativo: boolean; aoMudar: (on: boolean) => void; classe: string; titulo?: string; desabilitado?: boolean; children: ReactNode;
}) {
  // o ponteiro que segura (−1: a tecla Enter; null: solto)
  const seguro = useRef<number | null>(null);
  const mudar = useRef(aoMudar);
  mudar.current = aoMudar;
  const solta = (id?: number) => { if (seguro.current != null && (id == null || id === seguro.current)) { seguro.current = null; mudar.current(false); } };
  useEffect(() => {
    const fora = (ev: globalThis.PointerEvent) => solta(ev.pointerId);
    const tudo = () => solta();
    const visivel = () => { if (document.hidden) solta(); };
    window.addEventListener('pointerup', fora); window.addEventListener('pointercancel', fora); window.addEventListener('blur', tudo);
    document.addEventListener('visibilitychange', visivel);
    return () => {
      window.removeEventListener('pointerup', fora); window.removeEventListener('pointercancel', fora); window.removeEventListener('blur', tudo);
      document.removeEventListener('visibilitychange', visivel);
      solta();
    };
  }, []);
  const aperta = (ev: PointerEvent<HTMLButtonElement>) => {
    if (desabilitado || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    if (seguro.current == null) mudar.current(true);
    seguro.current = ev.pointerId;
  };
  // (a captura implícita do toque chega depois do pointerdown: é desfeita aqui)
  const capturado = (ev: PointerEvent<HTMLButtonElement>) => { try { ev.currentTarget.releasePointerCapture(ev.pointerId); } catch { /* já solto */ } };
  const move = (ev: PointerEvent<HTMLButtonElement>) => {
    if (ev.pointerId !== seguro.current) return;
    const r = ev.currentTarget.getBoundingClientRect();
    if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) solta(ev.pointerId);
  };
  const tecla = (ev: KeyboardEvent<HTMLButtonElement>, on: boolean) => {
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    if (on && !ev.repeat && seguro.current == null) { seguro.current = -1; mudar.current(true); } else if (!on) solta(-1);
  };
  return (
    <button type="button" id={id} className={classe} aria-pressed={ativo} title={titulo} disabled={desabilitado}
      onPointerDown={aperta} onGotPointerCapture={capturado} onPointerMove={move}
      onPointerUp={(ev) => solta(ev.pointerId)} onPointerLeave={(ev) => solta(ev.pointerId)} onPointerCancel={(ev) => solta(ev.pointerId)}
      onKeyDown={(ev) => tecla(ev, true)} onKeyUp={(ev) => tecla(ev, false)} onBlur={() => solta()}
      onContextMenu={(ev) => ev.preventDefault()}>{children}</button>
  );
}

const MARCAS_REGULADOR: [number, string][] = [[1, 'Aberto'], [0.75, '¾'], [0.5, '½'], [0.25, '¼'], [0, 'Fechado']];

/** a alavanca do regulador: arrasta (mouse e toque), fica onde foi deixada; PageUp/PageDown, Home/End com o foco */
function Regulador({ k, e }: P) {
  const v = e.cmd.regulador;
  const trilho = useRef<HTMLDivElement>(null);
  const mover = (ev: { clientY: number }) => {
    const r = trilho.current?.getBoundingClientRect(); if (!r) return;
    k.moverRegulador(clamp(1 - (ev.clientY - r.top) / r.height, 0, 1));
  };
  const teclas = (ev: KeyboardEvent<HTMLDivElement>) => {
    const passo: Record<string, number> = { PageUp: 0.1, PageDown: -0.1 };
    if (ev.code in passo) { ev.preventDefault(); k.moverRegulador(v + passo[ev.code], true); }
    else if (ev.code === 'Home') { ev.preventDefault(); k.moverRegulador(0, true); }
    else if (ev.code === 'End') { ev.preventDefault(); k.moverRegulador(1, true); }
  };
  const morto = e.corteAuto && e.sentido === 0 && v > 0;
  return (
    <div className="regulador">
      <div className="regulador-cab"><span className="k">Regulador</span><output className="mono" id="valorRegulador" htmlFor="alavancaRegulador">{pct(v)}</output></div>
      <div className="alavanca" id="alavancaRegulador" role="slider" tabIndex={0} aria-orientation="vertical"
        aria-label="Regulador: o acelerador da máquina (fica onde você deixar)" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(v * 100)} aria-valuetext={pct(v)}
        title="Arraste para abrir o regulador (W/S também movem); ele fica onde você deixar"
        onPointerDown={(ev) => { try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch { /* ponteiro sintético */ } mover(ev); }}
        onPointerMove={(ev) => { if (ev.currentTarget.hasPointerCapture(ev.pointerId)) mover(ev); }}
        onKeyDown={teclas}>
        <div className="alavanca-trilho" ref={trilho}><div className={`alavanca-cheio${morto ? ' morto' : ''}`} style={{ height: `${v * 100}%` }} /></div>
        <div className="alavanca-marcas" aria-hidden="true">
          {MARCAS_REGULADOR.map(([x, r]) => <span key={r} style={{ bottom: `${x * 100}%` }}>{r}</span>)}
        </div>
        <div className="alavanca-punho" style={{ bottom: `calc(12px + (100% - 24px) * ${v})` }} aria-hidden="true"><i /><i /><i /></div>
      </div>
      <button type="button" className="chip fechar" id="fecharRegulador" onClick={() => k.fecharRegulador()} disabled={v === 0} title="Fecha o regulador (X)">Fechar</button>
    </div>
  );
}

/** sentido de marcha e corte automático (ou a reversão à mão) */
function Direcao({ k, e, refs }: P & { refs: RefsConducao }) {
  const c = e.cmd;
  return (
    <div className="direcao">
      <Field rotulo="Sentido">
        <div className="sentido" role="group" aria-label="Sentido de marcha" id="sentido">
          {SENTIDOS.map((s) => (
            <button key={s.valor} type="button" className="key wide" data-sentido={s.valor} aria-pressed={e.corteAuto && e.sentido === s.valor} onClick={() => k.escolherSentido(s.valor)}>{s.rotulo}</button>
          ))}
        </div>
      </Field>
      <div className="auto-linha">
        <button type="button" className="chip auto-chave" id="corteAuto" role="switch" aria-checked={e.corteAuto} onClick={() => k.setCorteAuto(!e.corteAuto)}
          title="O corte automático faz o que o maquinista faz com a reversão: sai com o corte longo e encurta conforme a velocidade sobe">
          <span className="chave" aria-hidden="true" />Corte automático
        </button>
        <span className="auto-corte mono" id="corteAutoValor" ref={(el) => { if (el) refs.corte = el; }}>—</span>
      </div>
      {!e.corteAuto && (
        <Slider id="reversaoPalco" rotulo="Reversão à mão (A/D)" min={-1} max={1} passo={0.01} valor={c.reverser}
          formatar={(v) => (Math.abs(v) < 0.005 ? 'meio' : `${v > 0 ? 'frente' : 'ré'} · corte ${Math.round(corteDeRev(v) * 100)}%`)} aoMudar={(v) => k.moverReversao(v)} />
      )}
      {k.portador === 'trator' && (
        <Field rotulo="Marcha">
          <ChipGroup id="marcha" classe="num" opcoes={[0, 1, 2].map((m) => ({ valor: m, rotulo: m === 0 ? 'N' : `${m}ª`, titulo: m === 0 ? 'embreagem solta: a manivela em lenta no governador' : '' }))} atual={e.marcha} aoEscolher={(v) => k.setMarcha(v)} />
        </Field>
      )}
    </div>
  );
}

/** apito e freio de segurar, e os botões menores */
function Maos({ k, e }: P) {
  const c = e.cmd, P = k.P, t = k.portador;
  const torneiras = c.torneiras === 'auto' ? 'auto' : c.torneiras ? 'abertas' : 'fechadas';
  return (
    <div className="maos">
      <div className="segurar-linha">
        <BotaoDeSegurar id="botaoApito" classe="key wide segurar apito" ativo={e.apitando} aoMudar={(on) => k.apitar(on)} titulo="Segure para apitar (H)">
          <b>Apito</b><small>segure · H</small>
        </BotaoDeSegurar>
        {temFreio(t) && (
          <BotaoDeSegurar id="botaoFreio" classe="key wide segurar freio" ativo={e.freando} aoMudar={(on) => k.frear(on)} titulo="Segure para frear (Espaço)">
            <b>Freio</b><small>segure · Espaço</small>
          </BotaoDeSegurar>
        )}
      </div>
      <div className="acoes miudas">
        {temSino(P) && <button type="button" id="botaoSino" className="chip" aria-pressed={c.sino} onClick={() => k.alternarSino()} title="Liga e desliga o sino (B)">Sino</button>}
        {temAreia(P) && <BotaoDeSegurar id="botaoAreia" classe="chip segurar-chip" ativo={c.areia} aoMudar={(on) => k.areia(on)} titulo="Segure para jogar areia no trilho quando patinar (E)">Areia</BotaoDeSegurar>}
        {temTorneiras(P) && (
          <button type="button" id="botaoTorneiras" className="chip" aria-pressed={c.torneiras === true} onClick={() => k.alternarTorneiras()}
            title="Torneiras de purga dos cilindros (T): no automático abrem nas 15 primeiras voltas depois de parada">Torneiras: {torneiras}</button>
        )}
      </div>
    </div>
  );
}

export function Conducao({ k, refs }: { k: ControleVapor; refs: RefsConducao }) {
  const e = useSyncExternalStore(k.assinar, k.obter);
  const fixa = k.portador === 'gerador';
  return (
    <section className="conducao" aria-label="Condução">
      <div className="estado" ref={(el) => { if (el) refs.caixa = el; }} data-tom="neutro" aria-label="Estado da máquina">
        <span className="estado-ponto" aria-hidden="true" />
        <div className="estado-texto">
          <strong id="estadoTitulo" ref={(el) => { if (el) refs.titulo = el; }}>—</strong>
          <span id="estadoDetalhe" ref={(el) => { if (el) refs.detalhe = el; }} />
        </div>
      </div>
      {fixa ? (
        <div className="comandos fixa">
          <Field rotulo="Carga do eixo de transmissão">
            <ChipGroup id="carga" classe="num" opcoes={[0, 0.25, 0.5, 0.75, 1].map((f) => ({ valor: f, rotulo: pct(f) }))} atual={e.carga} aoEscolher={(v) => k.setCarga(v)} />
          </Field>
          <p className="note">A máquina de moinho não se dirige: o governador de esferas mexe no corte e no regulador para segurar a rotação quando a carga muda.</p>
        </div>
      ) : (
        <div className="comandos">
          <Regulador k={k} e={e} />
          <Direcao k={k} e={e} refs={refs} />
          <Maos k={k} e={e} />
        </div>
      )}
    </section>
  );
}

/** as demonstrações: roteiros prontos, num lugar secundário */
export function Demonstracoes({ k }: { k: ControleVapor }) {
  const e = useSyncExternalStore(k.assinar, k.obter);
  return (
    <section className="demos" aria-label="Demonstrações">
      <div className="demos-cab" title="Roteiros prontos: a página dirige por alguns segundos e devolve a máquina quando acaba ou quando você mexe no regulador, no sentido ou no freio">
        <span className="k">Demonstrações</span>
        <span className="note">Roteiros prontos: a página dirige por alguns segundos e devolve a máquina quando acaba ou quando você mexe no regulador, no sentido ou no freio.</span>
      </div>
      <div className="chips" id="cenarios" role="group" aria-label="Demonstrações">
        {CENARIOS.map((c) => (
          <button key={c.id} type="button" className="chip" data-cenario={c.id} aria-pressed={e.cenario === c.id} title={c.titulo}
            onClick={() => (e.cenario === c.id ? k.pararCenario() : void k.cenario(c.id).catch((err) => console.error(err)))}>{c.nome}</button>
        ))}
      </div>
    </section>
  );
}
