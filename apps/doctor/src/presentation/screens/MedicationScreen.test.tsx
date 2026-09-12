import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NEVER_BLOCKS_ES, RULESET_VERSION } from '@recetas/rules';
import { ALERT_DISMISSAL_COPY_ES, dismissAlert } from '../../domain/alerts';
import type { PrescriptionDraft } from '../../domain/draft';
import { aDraft, anItem } from '../../test/fixtures';
import { alertsFor, editDraft } from '../draft-editing';
import { MedicationScreen } from './MedicationScreen';

/** D3 — Medicación (docs/17). */

const JUSTIFICATION = 'Sin alternativa terapéutica; la reacción previa fue cutánea y leve.';

function allergicDraft(): PrescriptionDraft {
  return aDraft({
    items: [anItem({ activeIngredient: 'amoxicilina' })],
    patientContext: { declaredAllergies: ['amoxicilina'], concomitantMedication: [] },
  });
}

function duplicatedDraft(): PrescriptionDraft {
  return aDraft({
    items: [
      anItem({ activeIngredient: 'ibuprofeno', atcCode: 'M01AE01' }),
      anItem({ activeIngredient: 'naproxeno', atcCode: 'M01AE02' }),
    ],
  });
}

function justified(draft: PrescriptionDraft): PrescriptionDraft {
  const [alert] = alertsFor(draft);
  if (alert === undefined) throw new Error('expected an alert');

  return editDraft(draft, {
    justifications: dismissAlert(draft.justifications, {
      alert,
      text: JUSTIFICATION,
      recordedAt: '2026-09-11T13:41:00.000Z',
    }),
  });
}

/** Renders the screen with real draft state, so an edit re-runs the engine. */
function renderScreen(initial: PrescriptionDraft = duplicatedDraft()) {
  const onContinue = vi.fn();
  const onCriticalAlert = vi.fn();

  function Harness() {
    const [draft, setDraft] = useState(initial);
    return (
      <MedicationScreen
        draft={draft}
        onBack={vi.fn()}
        onContinue={onContinue}
        onCriticalAlert={onCriticalAlert}
        onDraftChange={setDraft}
      />
    );
  }

  render(<Harness />);
  return { onContinue, onCriticalAlert, user: userEvent.setup() };
}

describe('every alert is auditable', () => {
  it('cites the exact input values that produced it', () => {
    renderScreen();

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('M01AE01');
    expect(alert).toHaveTextContent('M01AE02');
  });

  it('cites the ruleset version that produced it', () => {
    renderScreen();

    expect(screen.getByRole('alert')).toHaveTextContent(RULESET_VERSION);
  });

  it('names its severity in words, never in colour alone', () => {
    renderScreen();

    expect(screen.getByRole('alert')).toHaveTextContent(/severidad moderada/i);
  });

  it('names the rule code, so the doctor can look it up', () => {
    renderScreen();

    expect(screen.getByRole('alert')).toHaveTextContent('DUPLICATE_THERAPY');
  });
});

describe('a decided alert stops shouting without disappearing', () => {
  it('moves into the quiet group, with the motive that was written', () => {
    renderScreen(justified(duplicatedDraft()));

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByText(new RegExp(ALERT_DISMISSAL_COPY_ES.dismissedGroupTitle))).toBeVisible();
    expect(document.body.textContent).toContain(JUSTIFICATION);
  });

  it('comes back the moment the item that triggered it is edited', async () => {
    const { user } = renderScreen(justified(duplicatedDraft()));
    expect(screen.queryByRole('alert')).toBeNull();

    // Editing the second item's ATC code breaks the duplication AND the alert
    // identity the decision was recorded against.
    const atc = screen.getByLabelText(/Código ATC/, { selector: '#item-1-atc' });
    await user.clear(atc);
    await user.type(atc, 'J01CA04');

    expect(document.body.textContent).not.toContain(JUSTIFICATION);
    expect(screen.queryByRole('alert')).toBeNull();

    // And typing the collision back produces a LIVE alert again, unsuppressed.
    await user.clear(atc);
    await user.type(atc, 'M01AE02');

    expect(screen.getByRole('alert')).toHaveTextContent('M01AE02');
    expect(document.body.textContent).not.toContain(JUSTIFICATION);
  });
});

describe('no alert blocks the way forward', () => {
  // docs/06, docs/17: "Ninguna alerta clínica bloquea la emisión."
  it('states it where it cannot be missed', () => {
    renderScreen();

    expect(screen.getByText(NEVER_BLOCKS_ES)).toBeVisible();
  });

  it('leaves the control that moves on to D5 enabled with a critical alert live', async () => {
    const { onContinue, user } = renderScreen(allergicDraft());

    expect(screen.getByRole('alert')).toHaveTextContent(/severidad crítica/i);

    const onward = screen.getByRole('button', { name: /revisar y firmar/i });
    expect(onward).toBeEnabled();

    await user.click(onward);
    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('moves on with a critical alert that was justified', async () => {
    const { onContinue, user } = renderScreen(justified(allergicDraft()));

    await user.click(screen.getByRole('button', { name: /revisar y firmar/i }));
    expect(onContinue).toHaveBeenCalledOnce();
  });
});

describe('the critical alert opens D4 and nothing else', () => {
  it('offers a control that raises the dialog, carrying the raw alert', async () => {
    const { onCriticalAlert, user } = renderScreen(allergicDraft());

    await user.click(screen.getByRole('button', { name: /valorar esta alerta/i }));

    expect(onCriticalAlert).toHaveBeenCalledOnce();
    expect(onCriticalAlert.mock.calls[0]?.[0]).toMatchObject({
      code: 'DECLARED_ALLERGY',
      severity: 'critical',
    });
  });

  it('offers no such control on a moderate alert', () => {
    renderScreen();

    expect(screen.queryByRole('button', { name: /valorar esta alerta/i })).toBeNull();
  });
});

describe('the form refuses to advance on incomplete items', () => {
  it('shows the catalogue message and does not continue', async () => {
    const { onContinue, user } = renderScreen(
      aDraft({ items: [anItem({ activeIngredient: '' })] }),
    );

    await user.click(screen.getByRole('button', { name: /revisar y firmar/i }));

    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText(/Complete principio activo, código ATC/)).toBeVisible();
  });

  it('ties the message to its control, and marks the control invalid', async () => {
    const { user } = renderScreen(aDraft({ items: [anItem({ activeIngredient: '' })] }));
    await user.click(screen.getByRole('button', { name: /revisar y firmar/i }));

    const control = screen.getByLabelText(/Principio activo/);
    expect(control).toHaveAttribute('aria-invalid', 'true');
    expect(control.getAttribute('aria-describedby')).toContain('item-0-ingredient-error');
  });
});

describe('D-07: no commercial product catalogue exists', () => {
  it('prescribes by active ingredient and ATC code only', () => {
    renderScreen();

    expect(screen.getByLabelText(/Principio activo/, { selector: '#item-0-ingredient' })).toBeVisible();
    expect(screen.getByLabelText(/Código ATC/, { selector: '#item-0-atc' })).toBeVisible();
    expect(screen.queryByLabelText(/marca|nombre comercial|producto comercial/i)).toBeNull();
  });
});
