import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RULESET_VERSION, type ClinicalAlert } from '@recetas/rules';
import { MIN_JUSTIFICATION_LENGTH } from '../../domain/alerts';
import { CriticalAlertDialog } from './CriticalAlertDialog';

/**
 * D4 — Alerta crítica (docs/17): "Modal con motivo escrito obligatorio; el
 * botón nace deshabilitado."
 */

const ALERT: ClinicalAlert = {
  code: 'DECLARED_ALLERGY',
  severity: 'critical',
  evidence: ['amoxicilina', 'amoxicilina'],
  rulesetVersion: RULESET_VERSION,
};

const NOW = (): Date => new Date('2026-09-11T13:41:00.000Z');

function renderDialog(overrides: { onRemoveOffendingItem?: () => void } = {}) {
  const onJustify = vi.fn();
  const onClose = vi.fn();

  render(
    <CriticalAlertDialog
      alert={ALERT}
      justifications={[]}
      now={NOW}
      onClose={onClose}
      onJustify={onJustify}
      {...overrides}
    />,
  );

  return {
    onJustify,
    onClose,
    user: userEvent.setup(),
    confirm: (): HTMLElement =>
      screen.getByRole('button', { name: /mantener bajo mi responsabilidad/i }),
    motive: (): HTMLElement => screen.getByLabelText(/motivo clínico/i),
  };
}

describe('the dialog is a real dialog', () => {
  it('is announced as a modal dialog, named by its own heading', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName(/alergia declarada/i);
  });

  it('moves focus into itself on open', () => {
    renderDialog();

    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('closes on Escape', async () => {
    const { onClose, user } = renderDialog();

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledOnce();
  });

  it('returns focus to the control that opened it', async () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)} type="button">
            Valorar esta alerta
          </button>
          {open && (
            <CriticalAlertDialog
              alert={ALERT}
              justifications={[]}
              now={NOW}
              onClose={() => setOpen(false)}
              onJustify={vi.fn()}
            />
          )}
        </>
      );
    }

    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: /valorar esta alerta/i });

    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('traps Tab inside itself', async () => {
    const { user } = renderDialog();
    const dialog = screen.getByRole('dialog');

    for (let press = 0; press < 8; press += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });
});

describe('the confirmation is born disabled', () => {
  it('is disabled on the very first render', () => {
    const { confirm } = renderDialog();

    expect(confirm()).toBeDisabled();
  });

  it('stays disabled for whitespace', async () => {
    const { confirm, motive, user } = renderDialog();

    await user.type(motive(), '              ');

    expect(confirm()).toBeDisabled();
  });

  it(`stays disabled below ${MIN_JUSTIFICATION_LENGTH} characters`, async () => {
    const { confirm, motive, user } = renderDialog();

    await user.type(motive(), 'a'.repeat(MIN_JUSTIFICATION_LENGTH - 1));

    expect(confirm()).toBeDisabled();
  });

  it(`enables exactly at ${MIN_JUSTIFICATION_LENGTH} characters`, async () => {
    const { confirm, motive, user } = renderDialog();

    await user.type(motive(), 'a'.repeat(MIN_JUSTIFICATION_LENGTH));

    expect(confirm()).toBeEnabled();
  });

  it('goes back to disabled when the motive is deleted again', async () => {
    const { confirm, motive, user } = renderDialog();
    await user.type(motive(), 'a'.repeat(MIN_JUSTIFICATION_LENGTH));
    expect(confirm()).toBeEnabled();

    await user.clear(motive());

    expect(confirm()).toBeDisabled();
  });

  it('never dismisses the alert on its own', async () => {
    const { onJustify, motive, user } = renderDialog();

    await user.type(motive(), 'a'.repeat(MIN_JUSTIFICATION_LENGTH + 5));

    // Typing a valid motive is not a decision. Pressing the button is.
    expect(onJustify).not.toHaveBeenCalled();
  });
});

describe('recording the decision', () => {
  it('hands back the decision with the trimmed motive and the instant', async () => {
    const { onJustify, confirm, motive, user } = renderDialog();

    await user.type(motive(), '  Sin alternativa terapéutica disponible.  ');
    await user.click(confirm());

    expect(onJustify).toHaveBeenCalledOnce();
    expect(onJustify.mock.calls[0]?.[0]).toEqual([
      {
        alertId: expect.stringContaining('DECLARED_ALLERGY'),
        code: 'DECLARED_ALLERGY',
        severity: 'critical',
        text: 'Sin alternativa terapéutica disponible.',
        recordedAt: '2026-09-11T13:41:00.000Z',
      },
    ]);
  });

  it('offers to withdraw the item instead, when one was identified', async () => {
    const onRemoveOffendingItem = vi.fn();
    const { user } = renderDialog({ onRemoveOffendingItem });

    await user.click(screen.getByRole('button', { name: /retirar el ítem/i }));

    expect(onRemoveOffendingItem).toHaveBeenCalledOnce();
  });

  it('offers no withdrawal when no item could be identified', () => {
    renderDialog();

    expect(screen.queryByRole('button', { name: /retirar el ítem/i })).toBeNull();
  });
});

describe('the alert stays auditable inside the dialog', () => {
  it('cites its evidence and its ruleset version', () => {
    renderDialog();

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('amoxicilina');
    expect(dialog).toHaveTextContent(RULESET_VERSION);
    expect(dialog).toHaveTextContent('DECLARED_ALLERGY');
  });

  it('names the severity in words as well as in colour', () => {
    renderDialog();

    expect(screen.getByRole('dialog')).toHaveTextContent(/severidad crítica/i);
  });
});
