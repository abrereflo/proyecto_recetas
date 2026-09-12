import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CONTEXT_DISCLAIMER_ES } from '@recetas/rules';
import {
  DRAFT_ISSUE_COPY_ES,
  expiresAtMidnight,
  type PrescriptionDraft,
} from '../../domain/draft';
import { ISSUED_AT_DATE, aDraft } from '../../test/fixtures';
import { emptyDraft } from '../draft-editing';
import { formatDay } from '../format';
import { PatientScreen } from './PatientScreen';

/** D2 — Paciente y contexto clínico (docs/17). */

function renderScreen(initial: PrescriptionDraft = emptyDraft()) {
  const onContinue = vi.fn();
  const onOpenPrescriptions = vi.fn();
  let latest = initial;

  function Harness() {
    const [draft, setDraft] = useState(initial);
    latest = draft;
    return (
      <PatientScreen
        draft={draft}
        now={ISSUED_AT_DATE}
        onContinue={onContinue}
        onDraftChange={setDraft}
        onOpenPrescriptions={onOpenPrescriptions}
      />
    );
  }

  render(<Harness />);

  return {
    onContinue,
    onOpenPrescriptions,
    user: userEvent.setup(),
    draft: (): PrescriptionDraft => latest,
  };
}

describe('D-25: the mandatory notice about what the engine sees', () => {
  it('carries the disclaimer the rules package owns, verbatim', () => {
    renderScreen();

    expect(screen.getByText(CONTEXT_DISCLAIMER_ES)).toBeVisible();
  });

  it('announces it as an alert, so it is not read as decoration', () => {
    renderScreen();

    const notices = screen.getAllByRole('alert');
    expect(notices.some((notice) => notice.textContent?.includes(CONTEXT_DISCLAIMER_ES))).toBe(
      true,
    );
  });

  it('says plainly that what is not declared is not detected', () => {
    renderScreen();

    expect(screen.getByText(/lo que no se declare aquí, no se detecta/i)).toBeVisible();
  });
});

describe('the declared context is what the engine will evaluate', () => {
  it('records the allergies the doctor types, split on commas', async () => {
    const { draft, user } = renderScreen();

    await user.type(screen.getByLabelText(/alergias declaradas/i), 'penicilinas, sulfamidas');

    expect(draft().patientContext.declaredAllergies).toEqual(['penicilinas', 'sulfamidas']);
  });

  it('records the concomitant medication the same way', async () => {
    const { draft, user } = renderScreen();

    await user.type(screen.getByLabelText(/medicación concomitante/i), 'warfarina 5 mg');

    expect(draft().patientContext.concomitantMedication).toEqual(['warfarina 5 mg']);
  });
});

describe('the form problems come from the core catalogue', () => {
  it('refuses to continue while the required fields are blank', async () => {
    const { onContinue, user } = renderScreen();

    await user.click(screen.getByRole('button', { name: /continuar a medicación/i }));

    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText(DRAFT_ISSUE_COPY_ES['patient-id-missing'])).toBeVisible();
    expect(screen.getByText(DRAFT_ISSUE_COPY_ES['practitioner-license-missing'])).toBeVisible();
  });

  it('ties each message to its control and marks the control invalid', async () => {
    const { user } = renderScreen();
    await user.click(screen.getByRole('button', { name: /continuar a medicación/i }));

    const control = screen.getByLabelText(/documento de identidad/i);
    expect(control).toHaveAttribute('aria-invalid', 'true');
    expect(control.getAttribute('aria-describedby')).toContain('patient-id-error');
    expect(control.closest('.field')).toHaveClass('field--invalid');
  });

  it('continues once the required fields are filled in', async () => {
    const { onContinue, user } = renderScreen(aDraft());

    await user.click(screen.getByRole('button', { name: /continuar a medicación/i }));

    expect(onContinue).toHaveBeenCalledOnce();
  });

  it('reports an impossible validity window with the catalogue message', async () => {
    const { onContinue, user } = renderScreen(aDraft({ validityDays: 0 }));

    await user.click(screen.getByRole('button', { name: /continuar a medicación/i }));

    expect(onContinue).not.toHaveBeenCalled();
    expect(screen.getByText(DRAFT_ISSUE_COPY_ES['validity-days-invalid'])).toBeVisible();
  });
});

describe('D-13: the expiry preview is a day, not an instant', () => {
  it('shows the date the prescription will expire on, with no time', () => {
    const draft = aDraft();
    renderScreen(draft);

    const expiresAt = expiresAtMidnight(ISSUED_AT_DATE, draft.validityDays);
    expect(screen.getByText(new RegExp(formatDay(expiresAt)))).toBeVisible();
    expect(document.body.textContent).not.toMatch(/\d{2}:\d{2}/);
  });

  it('says the preview cannot be derived rather than showing a wrong one', () => {
    renderScreen(aDraft({ validityDays: 0 }));

    expect(screen.getByText(/indique un número entero de días/i)).toBeVisible();
  });
});

describe('every control is labelled', () => {
  it('gives each input a real label element', () => {
    renderScreen();

    for (const input of Array.from(document.querySelectorAll('input'))) {
      expect(input.id).not.toBe('');
      expect(document.querySelector(`label[for="${input.id}"]`)).not.toBeNull();
    }
  });

  it('spells out "obligatorio" beside the decorative asterisk', () => {
    renderScreen();

    expect(screen.getAllByText(/\(obligatorio\)/).length).toBeGreaterThan(0);
  });
});
