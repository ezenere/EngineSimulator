// AudioShell: contexto React que cria a cadeia de áudio sob demanda (o navegador só deixa tocar
// depois de um gesto do usuário) e a entrega a quem estiver dentro dele.
//
//   <AudioShell perfil={PERFIL_RONCO} moduloUrl={url} processador="ronco-engine" ambiente="open" aoMensagem={...}>
//     ...  const { iniciar, audio } = useAudioShell();  await iniciar();  audio.send({...})
//   </AudioShell>
//
// O áudio não passa pelo React: telemetria chega em `aoMensagem` (guarde num ref e desenhe no
// requestAnimationFrame); o estado React só muda quando a cadeia fica pronta ou dá erro.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { CadeiaDeAudio, type OpcoesDaCadeia } from './cadeia';

export type EstadoDoAudio = 'parado' | 'carregando' | 'pronto' | 'erro';

type ValorDoShell = {
  audio: CadeiaDeAudio | null;
  estado: EstadoDoAudio;
  erro: unknown;
  // cria a cadeia na primeira chamada (as seguintes devolvem a mesma) e retoma o AudioContext
  iniciar: () => Promise<CadeiaDeAudio>;
};

const Contexto = createContext<ValorDoShell | null>(null);

export function AudioShell({ children, aoMensagem, ...opcoes }: OpcoesDaCadeia & { children?: ReactNode }) {
  const [audio, setAudio] = useState<CadeiaDeAudio | null>(null);
  const [estado, setEstado] = useState<EstadoDoAudio>('parado');
  const [erro, setErro] = useState<unknown>(null);
  const promessa = useRef<Promise<CadeiaDeAudio> | null>(null);
  // as opções valem na criação; o callback de mensagem é sempre o mais recente
  const opcoesRef = useRef(opcoes);
  opcoesRef.current = opcoes;
  const msgRef = useRef(aoMensagem);
  msgRef.current = aoMensagem;

  const iniciar = useCallback(async () => {
    if (!promessa.current) {
      setEstado('carregando');
      promessa.current = CadeiaDeAudio.criar({ ...opcoesRef.current, aoMensagem: (m) => msgRef.current?.(m) }).then(
        (c) => { setAudio(c); setEstado('pronto'); return c; },
        (e) => { promessa.current = null; setErro(e); setEstado('erro'); throw e; },
      );
    }
    const c = await promessa.current;
    await c.retomar();
    return c;
  }, []);

  // fecha o AudioContext ao desmontar a página
  useEffect(() => () => { promessa.current?.then((c) => c.ctx.close()).catch(() => {}); }, []);

  return <Contexto.Provider value={{ audio, estado, erro, iniciar }}>{children}</Contexto.Provider>;
}

export function useAudioShell(): ValorDoShell {
  const v = useContext(Contexto);
  if (!v) throw new Error('useAudioShell() fora de <AudioShell>');
  return v;
}
