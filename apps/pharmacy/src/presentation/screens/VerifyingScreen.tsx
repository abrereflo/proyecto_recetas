import type { CheckResult } from '../../domain/verification';
import { CheckList, CHECK_LABELS, firstPendingCheck } from '../components/CheckList';
import { ScreenShell } from '../components/ScreenShell';
import { shortHash } from '../format';

/**
 * P3 — Verificando.
 *
 * HARD RULE (docs/17, P3): this is NOT a spinner. Integrity, vigency,
 * uniqueness, signature and patient correspondence are five independent checks
 * that fail for five different reasons; collapsing them into one wheel stops
 * the pharmacist from knowing which one said no.
 *
 * The five rows are rendered from `pendingChecks()` before the first answer
 * arrives and are replaced by the outcome's own five rows, so what is on screen
 * is always exactly what the domain reported — never a green line over evidence
 * that was never gathered.
 */

export interface VerifyingScreenProps {
  /** The anchored content hash from the QR, shown so it can be read back. */
  contentHash: string;
  checks: CheckResult[];
}

export function VerifyingScreen({ contentHash, checks }: VerifyingScreenProps) {
  const current = firstPendingCheck(checks);

  return (
    <ScreenShell status={<span className="badge badge--info">Verificando</span>}>
      <div className="stack stack--loose">
        <div className="stack stack--tight">
          <h1 className="title-screen">Verificando receta</h1>
          <p className="mono text-muted">{shortHash(contentHash)}</p>
        </div>

        <CheckList checks={checks} currentId={current} />

        {/* Announced, not just coloured: a screen reader hears the step the
            verification is on and the verdict of each one (docs/17). */}
        <p aria-live="polite" className="sr-only" role="status">
          {current === undefined
            ? 'Comprobaciones terminadas.'
            : `Comprobando: ${CHECK_LABELS[current]}.`}
        </p>

        <p className="text-muted">
          La verificación consulta la cadena y descifra el documento en este dispositivo. No se
          entrega nada hasta que una persona lo confirme.
        </p>
      </div>
    </ScreenShell>
  );
}
