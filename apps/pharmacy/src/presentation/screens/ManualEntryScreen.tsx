import { useId, useState } from 'react';
import type { QrPayload } from '@recetas/shared';
import { ScreenShell } from '../components/ScreenShell';
import { readQrPayload } from '../qr-payload';

/**
 * P8 — Entrada manual.
 *
 * The camera contingency, present from the start rather than summoned after a
 * failure: the risk plan already assumes the camera fails in the room
 * (docs/17, P8).
 *
 * HARD RULE (docs/17, P8): it is a contingency, NOT a shortcut. What is typed
 * here goes through the same `readQrPayload` and the same five checks as a
 * scanned code; nothing about this path relaxes verification.
 *
 * HARD RULE (D-20, docs/17): no screen may promise offline operation. A
 * signature can be verified without a network, but that proves authenticity,
 * not uniqueness — without the chain there is no way to know whether the
 * prescription was already dispensed. This screen says so out loud.
 */

export interface ManualEntryScreenProps {
  onSubmit(qr: QrPayload): void;
  onCancel(): void;
  /** A problem reported by the flow, e.g. from a previous attempt. */
  problem?: string | undefined;
}

export function ManualEntryScreen({ onSubmit, onCancel, problem }: ManualEntryScreenProps) {
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const hintId = `${fieldId}-hint`;
  const [raw, setRaw] = useState('');
  const [localProblem, setLocalProblem] = useState<string | null>(null);
  const shown = localProblem ?? problem ?? null;

  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const read = readQrPayload(raw);

    if (!read.ok) {
      setLocalProblem(read.problem);
      return;
    }

    setLocalProblem(null);
    onSubmit(read.qr);
  };

  return (
    <ScreenShell status={<span className="badge badge--neutral">Entrada manual</span>}>
      <form className="stack stack--loose" onSubmit={submit}>
        <div className="stack stack--tight">
          <h1 className="title-screen">Ingresar código manualmente</h1>
          <p className="text-secondary">
            Use esta pantalla solo si la cámara no está disponible. La receta pasa exactamente por
            las mismas comprobaciones que si se hubiera escaneado.
          </p>
        </div>

        <div className={shown === null ? 'field' : 'field field--invalid'}>
          <label className="field__label" htmlFor={fieldId}>
            Contenido del código de la receta
          </label>
          <textarea
            aria-describedby={shown === null ? hintId : `${errorId} ${hintId}`}
            aria-invalid={shown !== null}
            className="field__control mono"
            id={fieldId}
            onChange={(event) => {
              setRaw(event.target.value);
              setLocalProblem(null);
            }}
            placeholder={'{"v":1,"chainId":84532,…}'}
            rows={8}
            value={raw}
          />
          <span className="field__hint" id={hintId}>
            Pegue el contenido completo del código, desde la primera llave hasta la última.
          </span>
          {shown !== null && (
            <span className="field__error" id={errorId} role="alert">
              <span aria-hidden="true">✗ </span>
              {shown}
            </span>
          )}
        </div>

        {/* D-20 is unresolved: offline dispensing has no decided behaviour, so
            this screen states the requirement instead of implying it works. */}
        <div className="alert alert--info">
          <span className="alert__icon" aria-hidden="true">
            ℹ
          </span>
          <div>
            <p className="alert__title">Se necesita conexión a internet</p>
            <p className="alert__body">
              La verificación consulta la cadena para saber si la receta ya fue dispensada. Sin
              conexión no es posible comprobarlo, y esta aplicación no permite entregar
              medicamentos sin esa comprobación.
            </p>
          </div>
        </div>

        <div className="stack">
          <button className="btn btn--primary btn--lg btn--block" type="submit">
            Verificar receta
          </button>
          <button className="btn btn--ghost btn--block" onClick={onCancel} type="button">
            Volver al escáner
          </button>
        </div>
      </form>
    </ScreenShell>
  );
}
