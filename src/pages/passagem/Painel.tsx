// Painel de controles da Passagem / modo de testes. Como nas outras páginas, o painel inteiro é
// montado de novo quando algo estrutural muda (tópico "painel"); as seções que o arrasto na cena 3D
// mexe (ouvinte, trajetória) assinam também o tópico "ouvinte", e os sliders acompanham o valor novo.
import { useLayoutEffect, useRef } from 'react';
import { ChipGroup, Field, Section, Slider } from '../../ui';
import { COMPAT } from '../../carriers/compat';
import { TREM_PAGINA_PADRAO, AMBIENTES, SOLOS, PORTADORES, NOME_MOTOR, MOTORES_PRONTOS, ESPERA_MOTOR, situacaoPortador, motoresProntos, presetsDoMotor } from './presets';
import { fmt, useTopico, AR_PADRAO, PADROES, type ControlePassagem } from './controle';
import { COR_TIPO } from './cena3d-cores';

export function Painel({ c }: { c: ControlePassagem }) {
  const versao = useTopico(c, 'painel');
  const aside = useRef<HTMLElement>(null);
  const scroll = useRef(0);
  scroll.current = aside.current?.scrollTop ?? scroll.current;
  useLayoutEffect(() => { if (aside.current) aside.current.scrollTop = scroll.current; }, [versao]);
  return (
    <aside className="controls" id="controls" aria-label="Parâmetros da passagem" ref={aside}>
      <Conteudo key={versao} c={c} />
    </aside>
  );
}

const km = (v: number) => `${fmt(v)} km/h`;
const m = (d = 1) => (v: number) => `${fmt(v, d)} m`;

function Conteudo({ c }: { c: ControlePassagem }) {
  const trem = c.portador === 'trem';
  const amb = c.ambienteCena();
  const padrao = PADROES[c.portador];
  const prontos = motoresProntos(c.portador);
  return (
    <>
      <Section titulo="Portador">
        <Field rotulo="O que passa">
          <ChipGroup id="portador" atual={c.portador} aoEscolher={(p) => c.setPortador(p)}
            opcoes={PORTADORES.map((p) => { const s = situacaoPortador(p.id); return { valor: p.id, rotulo: p.nome, desabilitado: !s.ok, titulo: `${p.descricao}. ${s.motivo}` }; })} />
        </Field>
        <Field rotulo="Motor">
          <ChipGroup id="motor" atual={c.motor} aoEscolher={(f) => c.setMotor(f)}
            opcoes={COMPAT[c.portador].map((f) => ({ valor: f, rotulo: NOME_MOTOR[f], desabilitado: !prontos.includes(f),
              titulo: prontos.includes(f) ? '' : MOTORES_PRONTOS.includes(f) ? 'Sem preset deste motor neste portador (só onde foi usado de verdade)' : `Espera o ${ESPERA_MOTOR[f] ?? 'adaptador'}` }))} />
        </Field>
        <p className="note">{trem && c.motor === 'eletrico' ? `Motor elétrico por truque (etapa 6): as unidades do motor replicadas nos truques motores, sob o assoalho. ${c.fontes.filter((f) => f.tipo !== 'pressao').length} fontes com propagação.`
          : trem ? `Sem motor: o som é do trem andando. ${c.fontes.filter((f) => f.tipo !== 'pressao').length} fontes com propagação.`
          : c.portador === 'rotor' ? (c.motor === 'nenhum' ? 'Rotor sem motor: Nr imposto (408 rpm), o coletivo muda a tração e o tapa das pás.' : 'Rotor com motor a pistão (Lycoming dos Robinson, Franklin do Bell 47, R-1340 do S-55): o governador do rotor mexe na borboleta e segura o Nr; o coletivo pede potência. O turboeixo ainda não existe.')
          : `${c.fontes.filter((f) => f.tipo !== 'pressao').length} fontes: as do motor (canais do DSP da família, em Pa a ${c.fontes[0] ? fmt(c.fontes[0].refDist) : '—'} m) e as do portador.`}</p>
      </Section>

      {(!trem || c.motor === 'eletrico') && c.portador !== 'rotor' && <Motor c={c} />}

      <Passagem c={c} />

      <Section titulo="Ambiente">
        <Field rotulo="Lugar">
          <ChipGroup id="ambiente" atual={c.ambiente} aoEscolher={(a) => c.setAmbiente(a)} opcoes={AMBIENTES.map((a) => ({ valor: a.id, rotulo: a.nome, titulo: a.nota }))} />
        </Field>
        <p className="note">{AMBIENTES.find((a) => a.id === c.ambiente)?.nota}. RT60 {amb.reverb.rt60?.map((x) => fmt(x, 1)).join(' / ')} s (125 / 500 / 2k / 8k Hz).</p>
        <Field rotulo="Solo">
          <ChipGroup<string> id="solo" atual={c.solo ?? 'auto'} aoEscolher={(s) => c.setSolo(s === 'auto' ? null : (s as typeof SOLOS[number]['id']))}
            opcoes={[{ valor: 'auto', rotulo: 'Do lugar' }, ...SOLOS.map((s) => ({ valor: s.id as string, rotulo: s.nome }))]} />
        </Field>
        <Slider id="rtFator" rotulo="RT60 (× do lugar)" min={0.25} max={3} passo={0.05} valor={c.rtFator} formatar={(v) => `× ${fmt(v, 2)}`} aoSoltar={(v) => c.setRt(v)} />
        {amb.tunel && <>
          <Slider id="tunelArea" rotulo="Seção do túnel" min={30} max={150} passo={1} valor={c.tunel.area} formatar={(v) => `${fmt(v)} m² · bloqueio ${fmt(c.corpo.areaFrontal / v, 3)}`} aoSoltar={(v) => { c.setTunel({ area: v }); c.avisar('painel'); }} />
          <Slider id="tunelComp" rotulo="Comprimento do túnel" min={200} max={10000} passo={50} valor={c.tunel.comprimento} formatar={(v) => `${fmt(v)} m`} aoSoltar={(v) => { c.setTunel({ comprimento: v }); c.avisar('painel'); }} />
          <Slider id="tunelBoca" rotulo="Boca do túnel antes do ouvinte" min={50} max={2000} passo={10} valor={-c.tunel.xEntrada} formatar={(v) => `${fmt(v)} m (a onda chega ${fmt(v * (1 / 343 - 1 / Math.max(1, c.vKmh / 3.6)), 1)} s antes do trem)`} aoSoltar={(v) => { c.setTunel({ xEntrada: -v }); c.avisar('painel'); }} />
        </>}
      </Section>

      <Trajetoria c={c} />
      <Ouvinte c={c} />

      {trem && <Trem c={c} />}
      {c.portador === 'rotor' && (
        <Section titulo="Helicóptero">
          <Slider id="coletivo" rotulo="Coletivo" min={0} max={1} passo={0.01} valor={c.coletivo} formatar={(v) => `${fmt(v * 100)}%${Math.abs(v - 0.75) < 0.03 ? ' (pairado)' : ''}`} aoMudar={(v) => c.setColetivo(v)} />
        </Section>
      )}

      <Section titulo="Ar">
        <Slider id="ur" rotulo="Umidade relativa" min={20} max={90} passo={1} valor={c.ar.ur} formatar={(v) => `${fmt(v)}%`} aoMudar={(v) => c.setAr({ ur: v })} />
        <Slider id="temperatura" rotulo="Temperatura" min={-20} max={45} passo={1} valor={c.ar.temperatura} formatar={(v) => `${fmt(v)} °C · c = ${fmt(343 * Math.sqrt((273.15 + v) / 293.15), 1)} m/s`} aoMudar={(v) => c.setAr({ temperatura: v })} />
        <p className="note">A absorção do ar segue a ISO 9613-1 (tabela de 20 °C) pela umidade; a temperatura muda a velocidade do som, e com ela o Doppler e os atrasos.</p>
      </Section>

      <Section titulo="Escuta">
        <Slider id="master" rotulo="Volume" min={0} max={1.5} passo={0.01} valor={c.master} formatar={(v) => `${fmt(v * 100)}%`} aoMudar={(v) => c.setMaster(v)} />
        <p className="note">Escala absoluta: 0 dBFS = 124 dB SPL com o volume em 100%. Um trem-bala a 3 m chega a 115–120 dB(A): comece baixo.</p>
      </Section>

      <Section titulo="Modo de testes">
        <p className="note">{`Padrões do CENA para ${trem ? 'o trem' : PORTADORES.find((x) => x.id === c.portador)?.nome.toLowerCase()}: via ${padrao.traj.tipo} de ${fmt(padrao.traj.comprimento)} m, ${fmt(padrao.traj.lateral)} m da lateral, ${km(padrao.vKmh)}, ${AMBIENTES.find((a) => a.id === padrao.ambiente)?.nome.toLowerCase()}, umidade ${AR_PADRAO.ur}%, ${AR_PADRAO.temperatura} °C${trem ? `, ${TREM_PAGINA_PADRAO.N} vagões de ${TREM_PAGINA_PADRAO.Lc} m` : ''}.`}</p>
        <button type="button" className="key wide" id="padrao" onClick={() => c.voltarAoPadrao()}>Voltar ao padrão</button>
      </Section>
    </>
  );
}

/** Motor: o preset da família (as listas das páginas Ronco, Diesel e Turbina) e o comando do portador. */
function Motor({ c }: { c: ControlePassagem }) {
  const opcoes = presetsDoMotor(c.portador, c.motor);
  const atual = opcoes.find((o) => o.id === c.motorPreset);
  const p = c.portador;
  return (
    <Section titulo="Motor">
      <Field rotulo="Preset">
        <select id="motorPreset" className="sel" value={c.motorPreset ?? ''} onChange={(e) => c.setMotorPreset(e.target.value)}>
          {opcoes.map((o) => <option key={o.id} value={o.id}>{o.nome} · {o.tag}</option>)}
        </select>
      </Field>
      <p className="note">{atual ? `${atual.nome}: ${atual.tag}. O som é o do DSP da família, sem os painéis de ajuste dela (escape, admissão, mixagem): esses ficam na página do motor.` : ''}</p>
      {c.motor === 'eletrico' && <>
        <Slider id="pedal" rotulo={p === 'drone' ? 'Coletivo (50% = pairado)' : p === 'trem' ? 'Tração na passagem' : 'Acelerador na passagem'} min={0} max={1} passo={0.01} valor={c.pedal} formatar={(v) => `${fmt(v * 100)}%`} aoSoltar={(v) => c.setPedal(v)} />
        {p !== 'drone' && <Slider id="freio" rotulo="Freio elétrico (regeneração)" min={0} max={1} passo={0.01} valor={c.freio} formatar={(v) => `${fmt(v * 100)}%`} aoSoltar={(v) => c.setFreio(v)} />}
        <p className="note">{c.partida ? 'A passagem parte parada: a velocidade vem do motor (o do-re-mi do Taurus).' : 'Na passagem a velocidade é imposta (dinamômetro): o pedal e o freio mudam o torque, e o som segue a corrente.'}</p>
      </>}
      {p === 'carro' && c.motor !== 'eletrico' && <>
        <Slider id="pedal" rotulo="Acelerador na passagem" min={0} max={1} passo={0.01} valor={c.pedal} formatar={(v) => `${fmt(v * 100)}%`} aoSoltar={(v) => c.setPedal(v)} />
        <Field rotulo="Marcha na passagem">
          <ChipGroup id="marcha" atual={c.marcha} aoEscolher={(v) => c.setMarcha(v)} opcoes={[1, 2, 3, 4, 5, 6].map((n) => ({ valor: n, rotulo: `${n}ª` }))} />
        </Field>
        <p className="note">Na passagem a velocidade é imposta e o motor fica preso às rodas na marcha escolhida (como num dinamômetro de rolo); parado, ponto morto e lenta.</p>
      </>}
      {(p === 'helice' || p === 'aviao') && <Slider id="pedal" rotulo="Manete" min={0} max={p === 'aviao' ? 1.3 : 1} passo={0.01} valor={c.pedal} formatar={(v) => `${fmt(v * 100)}%${v > 1 ? ' (pós-combustão)' : ''}`} aoSoltar={(v) => c.setPedal(v)} />}
      {p === 'locomotiva' && <Field rotulo="Notch">
        <ChipGroup id="notch" atual={c.notch} aoEscolher={(v) => c.setNotch(v)} opcoes={[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ valor: n, rotulo: n === 0 ? 'Lenta' : `N${n}` }))} />
      </Field>}
      {p === 'gerador' && <Field rotulo="Carga elétrica">
        <ChipGroup id="carga" atual={c.cargaFracao} aoEscolher={(v) => c.setCarga(v)} opcoes={[0, 0.25, 0.5, 0.75, 1].map((f) => ({ valor: f, rotulo: `${fmt(f * 100)}%` }))} />
      </Field>}
    </Section>
  );
}

function Passagem({ c }: { c: ControlePassagem }) {
  useTopico(c, 'estado');
  return (
    <Section titulo="Passagem">
      <div className="acoes">
        <button type="button" className="key wide" id="disparar" onClick={() => (c.andando ? c.parar() : c.disparar())}>{c.andando ? 'Parar' : 'Disparar passagem'}</button>
        <button type="button" className="key wide" id="repetir" aria-pressed={c.repetir} onClick={() => c.setRepetir(!c.repetir)}>{c.repetir ? 'Repetindo em volta' : 'Uma vez'}</button>
      </div>
      <Slider id="vKmh" rotulo="Velocidade" min={0} max={c.portador === 'rotor' ? 400 : c.portador === 'aviao' ? 2500 : 600} passo={5} valor={c.vKmh} formatar={(v) => `${km(v)} · Mach ${fmt(v / 3.6 / 343, 3)}`} aoMudar={(v) => c.setV(v)} />
      <Slider id="x0" rotulo="O nariz parte a" min={50} max={2000} passo={10} valor={c.x0} formatar={(v) => `${fmt(v)} m do ouvinte`} aoMudar={(v) => { c.x0 = v; }} />
      <p className="note"><kbd>Espaço</kbd> dispara ou para · <kbd>R</kbd> repetir · <kbd>G</kbd> gimbal · <kbd>C</kbd> câmera (com a cena em foco)</p>
    </Section>
  );
}

function Trajetoria({ c }: { c: ControlePassagem }) {
  useTopico(c, 'ouvinte');
  const t = c.traj;
  return (
    <Section titulo="Trajetória">
      <Field rotulo="Via">
        <ChipGroup id="trajTipo" atual={t.tipo} aoEscolher={(v) => c.setTraj({ tipo: v }, true)} opcoes={[{ valor: 'reta' as const, rotulo: 'Reta', titulo: 'O corpo reaparece do outro lado' }, { valor: 'volta' as const, rotulo: 'Volta', titulo: 'Oval com duas retas e dois semicírculos' }]} />
      </Field>
      <Field rotulo="Sentido">
        <ChipGroup id="sentido" atual={t.sentido} aoEscolher={(v) => c.setTraj({ sentido: v }, true)} opcoes={[{ valor: 1 as const, rotulo: 'Da esquerda para a direita' }, { valor: -1 as const, rotulo: 'Da direita para a esquerda' }]} />
      </Field>
      <Slider id="comprimento" rotulo={t.tipo === 'reta' ? 'Comprimento da reta' : 'Perímetro da volta'} min={200} max={20000} passo={50} valor={t.comprimento} formatar={m(0)} aoSoltar={(v) => c.setTraj({ comprimento: v }, true)} />
      {t.tipo === 'volta' && <Slider id="raio" rotulo="Raio das curvas" min={20} max={3000} passo={10} valor={t.raioCurva} formatar={m(0)} aoSoltar={(v) => c.setTraj({ raioCurva: v }, true)} />}
      <Slider id="lateral" rotulo="Distância do ouvinte à lateral" min={0} max={300} passo={0.5} valor={t.lateral} formatar={m(1)} aoMudar={(v) => c.setTraj({ lateral: v })} />
      <Slider id="altitude" rotulo="Altitude do corpo" min={0} max={3000} passo={1} valor={t.altitude} formatar={m(0)} aoMudar={(v) => c.setTraj({ altitude: v })} />
    </Section>
  );
}

function Ouvinte({ c }: { c: ControlePassagem }) {
  useTopico(c, 'ouvinte');
  const o = c.ouv, g = o.gimbal;
  const ficha = c.fonteFicha ? c.fontes.find((f) => f.id === c.fonteFicha) : null;
  const tf = ficha && c.tele ? c.tele.cena.fontes.find((x) => x.id === ficha.id) : null;
  return (
    <Section titulo="Ouvinte">
      <Field rotulo="Onde">
        <ChipGroup id="modoOuvinte" atual={o.modo} aoEscolher={(v) => c.setModo(v)} opcoes={[{ valor: 'fixo' as const, rotulo: 'Parado junto à via' }, { valor: 'gimbal' as const, rotulo: 'No gimbal do corpo', titulo: 'Anda com o corpo, em torno dele ou de uma fonte' }]} />
      </Field>
      <Field rotulo="Atalhos">
        <div className="chips" id="atalhos">
          {c.atalhos().map((a) => <button key={a.id} type="button" className="chip" data-id={a.id} disabled={!a.ok} title={a.titulo} onClick={() => c.aplicarAtalho(a)}>{a.nome}</button>)}
        </div>
      </Field>
      <Field rotulo="Filtro do local">
        <ChipGroup id="local" atual={o.local} aoEscolher={(v) => c.setLocal(v)} opcoes={[
          { valor: 'auto' as const, rotulo: 'Automático', titulo: 'Cabine se o ponto cai dentro do corpo, senão fora' },
          { valor: 'fora' as const, rotulo: 'Fora', titulo: 'Diretividade, sombra, solo e propagação + ITD/ILD' },
          { valor: 'cabine' as const, rotulo: 'Cabine', titulo: 'Lei da massa da casca e ressonância do habitáculo' },
          { valor: 'cofre' as const, rotulo: 'Cofre', titulo: 'Fontes de dentro diretas; as de fora por um passa-baixa de 900 Hz' },
          { valor: 'ponteira' as const, rotulo: 'Ponteira', titulo: 'Só a fonte alvo; as outras −20 dB, sem solo' },
        ]} />
      </Field>
      <p className="note" id="localEfetivo">{`Local agora: ${c.localEfetivo()}.`}</p>
      {o.modo === 'fixo' ? <>
        <Slider id="ouvX" rotulo="Posição ao longo da via" min={-500} max={500} passo={0.5} valor={o.pos[0]} formatar={m(1)} aoMudar={(v) => c.setOuvinte({ pos: [v, 0, o.pos[2]] })} />
        <Slider id="ouvZ" rotulo="Altura do ouvido" min={0.2} max={20} passo={0.1} valor={o.pos[2]} formatar={m(1)} aoMudar={(v) => c.setOuvinte({ pos: [o.pos[0], 0, v] })} />
      </> : <>
        <Field rotulo="Alvo do gimbal">
          <select id="alvo" className="sel" value={g.alvo} onChange={(e) => { c.setOuvinte({}, { alvo: e.target.value }); c.escolherFonte(e.target.value === 'corpo' ? null : e.target.value); }}>
            <option value="corpo">Centro do corpo</option>
            {c.fontes.filter((f) => f.tipo !== 'pressao').map((f) => <option key={f.id} value={f.id}>{f.id} ({f.tipo})</option>)}
          </select>
        </Field>
        <Slider id="az" rotulo="Azimute" min={-180} max={180} passo={1} valor={g.az} formatar={(v) => `${fmt(v)}° ${Math.abs(v) < 20 ? '(frente)' : Math.abs(v) > 160 ? '(trás)' : v > 0 ? '(esquerda)' : '(direita)'}`} aoMudar={(v) => c.setOuvinte({}, { az: v })} />
        <Slider id="el" rotulo="Elevação" min={-20} max={89} passo={1} valor={g.el} formatar={(v) => `${fmt(v)}°`} aoMudar={(v) => c.setOuvinte({}, { el: v })} />
        <Slider id="r" rotulo="Distância ao alvo" min={0.3} max={300} passo={0.1} valor={g.r} formatar={m(1)} aoMudar={(v) => c.setOuvinte({}, { r: v })} />
      </>}
      <Field rotulo="Cabeça">
        <ChipGroup id="binaural" atual={o.binaural} aoEscolher={(v) => { c.setOuvinte({ binaural: v }); c.enviarPendentes(); }} opcoes={[{ valor: true, rotulo: 'Binaural (ITD + ILD)' }, { valor: false, rotulo: 'Mono' }]} />
      </Field>
      {ficha && (
        <div className="ficha" id="ficha">
          <b style={{ color: `#${COR_TIPO[ficha.tipo].toString(16).padStart(6, '0')}` }}>{ficha.id}</b>
          <span>{ficha.tipo}{ficha.dentro ? ' · dentro' : ''} · em ({ficha.pos.map((x) => fmt(x, 2)).join('; ')}) m · refDist {fmt(ficha.refDist, 1)} m</span>
          <span>diretividade [{ficha.dir.tabela.join(', ')}] dB, eixo ({ficha.dir.eixo.join(', ')}), convecção {ficha.dir.expConv}</span>
          {tf && <span>ganho {fmt(tf.ganhoDb, 1)} dB · {fmt(tf.r, 1)} m · atraso {fmt(tf.atrasoMs, 1)} ms</span>}
          <button type="button" className="chip" onClick={() => c.escolherFonte(null)}>Fechar</button>
        </div>
      )}
    </Section>
  );
}

function Trem({ c }: { c: ControlePassagem }) {
  const t = c.trem, max = c.maxVagoes();
  const vagoes = Array.from({ length: t.N }, (_, i) => i + 1);
  return (
    <Section titulo="Trem">
      <Slider id="N" rotulo="Vagões" min={1} max={max} passo={1} valor={t.N} formatar={(v) => `${v} · ${fmt(v * t.Lc - t.vao, 1)} m`} aoSoltar={(v) => c.setTrem({ N: v })} />
      <p className="note">{`Até ${max} vagões nesta configuração (orçamento de 64 fontes da Cena, CENA 5.1).`}</p>
      <Slider id="Lc" rotulo="Passo do vagão" min={15} max={27} passo={0.1} valor={t.Lc} formatar={(v) => `${fmt(v, 1)} m · vãos a ${fmt(c.vKmh / 3.6 / v, 2)} Hz`} aoSoltar={(v) => c.setTrem({ Lc: v })} />
      <Slider id="vao" rotulo="Vão entre vagões" min={0.2} max={1} passo={0.05} valor={t.vao} formatar={m(2)} aoSoltar={(v) => c.setTrem({ vao: v })} />
      <Slider id="truque" rotulo="Truque a partir da ponta" min={2} max={5} passo={0.05} valor={t.truqueExtremidade} formatar={m(2)} aoSoltar={(v) => c.setTrem({ truqueExtremidade: v })} />
      <Slider id="lNariz" rotulo="Comprimento do nariz" min={0} max={20} passo={0.5} valor={t.lNariz} formatar={(v) => `${fmt(v, 1)} m${v > 0 ? ` · σ ${fmt((v / (3 * Math.max(1, c.vKmh / 3.6))) * 1000)} ms` : ''}`} aoSoltar={(v) => c.setTrem({ lNariz: v })} />
      <Slider id="cpNariz" rotulo="Coeficiente de pressão do nariz" min={0.05} max={0.4} passo={0.01} valor={t.cpNariz} formatar={(v) => `${fmt(v, 2)}${v < 0.17 ? ' (trem-bala)' : v > 0.25 ? ' (rombudo)' : ''}`} aoSoltar={(v) => c.setTrem({ cpNariz: v })} />
      <Slider id="largura" rotulo="Largura" min={2.6} max={3.8} passo={0.02} valor={t.largura} formatar={m(2)} aoSoltar={(v) => c.setTrem({ largura: v })} />
      <Slider id="alturaTrem" rotulo="Altura" min={3} max={4.6} passo={0.05} valor={t.altura} formatar={m(2)} aoSoltar={(v) => c.setTrem({ altura: v })} />
      <Field rotulo="Pantógrafos (vagões)">
        <div className="chips num" id="pantografos">
          {vagoes.map((v) => <button key={v} type="button" className="chip num" aria-pressed={t.pantografos.includes(v)}
            onClick={() => c.setTrem({ pantografos: t.pantografos.includes(v) ? t.pantografos.filter((x) => x !== v) : [...t.pantografos, v].sort((a, b) => a - b) })}>{v}</button>)}
        </div>
      </Field>
      <Field rotulo="Carenagem do pantógrafo">
        <ChipGroup id="carenagem" atual={t.carenagem} aoEscolher={(v) => c.setTrem({ carenagem: v })} opcoes={[{ valor: true, rotulo: 'Com (−10 dB)' }, { valor: false, rotulo: 'Sem' }]} />
      </Field>
    </Section>
  );
}
