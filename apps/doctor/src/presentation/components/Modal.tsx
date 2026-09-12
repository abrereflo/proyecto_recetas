import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';

/**
 * A real modal dialog, for screen D4.
 *
 * design/mockups/board.css also defines `.modal-backdrop` and `.modal`, but
 * that file is presentation-board scaffolding: its backdrop sits INSIDE a
 * mockup frame, so it is never positioned and never covers anything. An
 * interruption that does not cover the screen it interrupts is a card. The real
 * overlay lives in design/components.css instead, beside every other class both
 * apps share.
 *
 * What makes this a dialog rather than a div (docs/17, accessibility):
 *  - `role="dialog"` plus `aria-modal`, labelled by its own heading;
 *  - focus moves into it on open and RETURNS to whatever opened it on close,
 *    so the doctor does not land back at the top of the document;
 *  - Tab is trapped, so the keyboard cannot wander into the form behind it;
 *  - Escape closes it. Closing is not deciding: on D4 the alert stays active
 *    and the doctor is back on D3 editing the item that raised it.
 */

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  /** Rendered as the dialog's accessible name. */
  title: string;
  onClose(): void;
  children: ReactNode;
}

export function Modal({ title, onClose, children }: ModalProps) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();

  const focusable = useCallback((): HTMLElement[] => {
    const root = dialog.current;
    if (root === null) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
  }, []);

  // Captured on mount so focus can be handed back to the exact control that
  // opened the dialog, which is the one the doctor was looking at.
  useEffect(() => {
    const opener = document.activeElement;
    const [first] = focusable();
    (first ?? dialog.current)?.focus();

    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, [focusable]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== 'Tab') return;

      const controls = focusable();
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (first === undefined || last === undefined) return;

      // The trap: the two ends of the list wrap into each other, so Tab can
      // never reach the prescription form behind the overlay.
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
        return;
      }

      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [focusable, onClose]);

  return (
    <div className="modal-backdrop">
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="modal stack"
        ref={dialog}
        role="dialog"
        tabIndex={-1}
      >
        <h2 className="title-screen" id={titleId}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}
