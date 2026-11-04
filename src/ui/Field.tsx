// Campo com rótulo em cima (equivalente a field() de app.js/jet-app.js).
import type { ReactNode } from 'react';

export function Field({ rotulo, extra, children, hidden }: { rotulo: string; extra?: ReactNode; children?: ReactNode; hidden?: boolean }) {
  return (
    <div className="field" hidden={hidden}>
      <div className="lab"><span>{rotulo}</span>{extra}</div>
      {children}
    </div>
  );
}
