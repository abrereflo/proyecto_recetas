import type { ReactNode } from 'react';

/**
 * One labelled form control, shared by D2, D3 and D4.
 *
 * ACCESSIBILITY (docs/17): every input has a real `<label>`; the hint and the
 * error are tied to the control through `aria-describedby`, so a screen reader
 * reads them as part of the field rather than as loose text further down the
 * page; and the asterisk that marks a required field is decorative, with the
 * word spelled out for assistive technology beside it — an asterisk read as
 * "star" is not a requirement.
 *
 * The control itself is a render prop rather than a prop-drilled `<input>`: D3
 * needs a numeric field, D4 needs a textarea, and a component that grew a
 * `type` union would end up owning both.
 */

export interface ControlProps {
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  className: string;
  id: string;
}

export interface FieldProps {
  id: string;
  label: string;
  required?: boolean;
  hint?: string | undefined;
  /** The message from `DRAFT_ISSUE_COPY_ES`, never copy written here. */
  error?: string | undefined;
  children(props: ControlProps): ReactNode;
}

export function Field({ id, label, required = false, hint, error, children }: FieldProps) {
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy = [errorId, hintId].filter((value) => value !== undefined).join(' ');

  const props: ControlProps = {
    className: 'field__control',
    id,
    ...(describedBy.length > 0 ? { 'aria-describedby': describedBy } : {}),
    ...(error === undefined ? {} : { 'aria-invalid': true as const }),
  };

  return (
    <div className={error === undefined ? 'field' : 'field field--invalid'}>
      <label className="field__label" htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden="true" className="field__required">
            *
          </span>
        )}
        {required && <span className="sr-only"> (obligatorio)</span>}
      </label>

      {children(props)}

      {error !== undefined && (
        <span className="field__error" id={errorId}>
          {error}
        </span>
      )}
      {hint !== undefined && (
        <span className="field__hint" id={hintId}>
          {hint}
        </span>
      )}
    </div>
  );
}
