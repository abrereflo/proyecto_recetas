import type { ReactNode } from 'react';

/**
 * The app shell every screen shares, except P2.
 *
 * P2 deliberately does NOT use it: "Pantalla completa; la cámara es toda la
 * interfaz" (docs/17, P2). An app bar floating over a viewfinder steals the
 * only thing that screen is for.
 */
export interface ScreenShellProps {
  /** Optional status chip on the right of the bar. */
  status?: ReactNode;
  children: ReactNode;
}

export function ScreenShell({ status, children }: ScreenShellProps) {
  return (
    <div className="app-shell">
      <header className="app-bar">
        <span className="app-bar__brand">Receta Verificable</span>
        {status}
      </header>

      <main className="app-main app-main--narrow">{children}</main>
    </div>
  );
}
