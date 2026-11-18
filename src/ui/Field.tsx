// Campo com rótulo em cima (equivalente a field() de app.js/jet-app.js). O rótulo vai por contexto para o grupo de
// chips de dentro, que o usa como nome acessível.
import { createContext, type ReactNode } from 'react';

export const RotuloDoCampo = createContext<string | undefined>(undefined);

export function Field({ rotulo, extra, children, hidden }: { rotulo: string; extra?: ReactNode; children?: ReactNode; hidden?: boolean }) {
  return (
    <div className="field" hidden={hidden}>
      <div className="lab"><span>{rotulo}</span>{extra}</div>
      <RotuloDoCampo.Provider value={rotulo}>{children}</RotuloDoCampo.Provider>
    </div>
  );
}
