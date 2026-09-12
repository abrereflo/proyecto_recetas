import type { ReactNode } from 'react';

/**
 * The app shell every doctor screen shares.
 *
 * Mirrors apps/pharmacy/src/presentation/components/ScreenShell.tsx. The doctor
 * app has no full-bleed screen of its own: the prescription is written sitting
 * at a workstation with a keyboard (docs/17), so the bar stays everywhere and
 * the content column keeps the same width from D1 to D7.
 */
export interface ScreenShellProps {
  /** Optional status chip on the right of the bar. */
  status?: ReactNode;
  /** Set on the wide screens: D3 and D7 hold lists, not a single form. */
  wide?: boolean;
  children: ReactNode;
}

export function ScreenShell({ status, wide = false, children }: ScreenShellProps) {
  return (
    <div className="app-shell">
      <header className="app-bar">
        <span className="app-bar__brand">Receta Verificable</span>
        {status}
      </header>

      <main className={wide ? 'app-main' : 'app-main app-main--narrow'}>{children}</main>
    </div>
  );
}
