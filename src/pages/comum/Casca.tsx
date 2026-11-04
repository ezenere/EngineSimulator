// Casca comum de Ronco e Turbina durante a migração: barra, navegação de famílias e presets,
// aviso no centro e a prova do worklet no painel lateral.
import { useRef, useState, type ReactNode } from 'react';
import { AudioShell, Barra, FamilyNav, PresetNav, type PerfilDeAudio, type Familia, type PresetResumo } from '../../ui';
import { TomDSP } from '../../worklet/tom';
import urlTom from '../../worklet/processador-tom.ts?worker&url';
import { ProvaDoWorklet } from './ProvaDoWorklet';

export function Casca({ logo, perfil, presets, ouvinte, legado }: {
  logo: string;
  perfil: PerfilDeAudio;
  presets: PresetResumo[] & { families: Familia[] };
  ouvinte: string;
  legado: ReactNode; // onde está a versão completa
}) {
  const [familia, setFamilia] = useState(presets[0].family);
  const [presetId, setPresetId] = useState<string | null>(presets[0].id);
  const tele = useRef<{ f: number; amp: number; t: number } | null>(null);
  const atual = presets.find((p) => p.id === presetId);

  return (
    <AudioShell perfil={perfil} moduloUrl={urlTom} processador="prova-tom" criarDspLocal={(fs) => new TomDSP(fs)}
      ambiente={Object.keys(perfil.ambientes)[0]} ouvinte={ouvinte}
      aoMensagem={(m) => { if (m.type === 'telemetry') tele.current = m; }}>
      <div className="app">
        <Barra logo={logo} placa={`${atual ? atual.name + ' · ' : ''}migração em andamento`} />
        <nav className="presets" aria-label="Motores prontos">
          <FamilyNav familias={presets.families} presets={presets} atual={familia} aoEscolher={setFamilia} />
          <PresetNav presets={presets} familia={familia} atual={presetId} aoEscolher={(p) => setPresetId(p.id)} />
        </nav>
        <main className="casca">
          <div className="aviso">
            <h1>Migração em andamento</h1>
            <p>Esta página está sendo reconstruída em TypeScript e React. Por enquanto ela tem só a navegação e a prova do áudio; o motor ainda não toca aqui.</p>
            <p>A versão completa continua {legado}.</p>
          </div>
        </main>
        <aside className="controls" aria-label="Parâmetros do motor">
          <ProvaDoWorklet ambientes={perfil.ambientes} telemetria={tele} />
        </aside>
      </div>
    </AudioShell>
  );
}
