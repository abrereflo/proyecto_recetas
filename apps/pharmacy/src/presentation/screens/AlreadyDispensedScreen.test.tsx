import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_REJECTION_FORMATTERS } from '../../domain/rejection';
import { CONTENT_HASH, DISPENSED_AT, PHARMACY_A, SALT, aDocument } from '../../test/fixtures';
import { AlreadyDispensedScreen } from './AlreadyDispensedScreen';

/**
 * P6 is the verdict the whole product is built around (docs/00, docs/04,
 * docs/17), so its two hard rules are asserted here: it names who and when, and
 * it offers no way back.
 */

const REASON = {
  code: 'already-dispensed',
  dispensedBy: PHARMACY_A,
  dispensedAt: DISPENSED_AT,
} as const;

function renderScreen() {
  const onScanAnother = vi.fn();
  render(
    <AlreadyDispensedScreen
      contentHash={CONTENT_HASH}
      onScanAnother={onScanAnother}
      reason={REASON}
    />,
  );
  return { onScanAnother };
}

describe('the verdict names who and when', () => {
  it('renders the pharmacy that dispensed it', () => {
    renderScreen();

    const short = DEFAULT_REJECTION_FORMATTERS.address(PHARMACY_A);
    expect(screen.getAllByText(new RegExp(short.replace('…', '.'), 'i')).length).toBeGreaterThan(0);
  });

  it('renders the moment it was dispensed', () => {
    renderScreen();

    // 2026-09-11T13:42:00Z is 09:42 in America/La_Paz.
    expect(document.body.textContent).toContain(
      DEFAULT_REJECTION_FORMATTERS.dateTime(DISPENSED_AT),
    );
  });

  it('uses the refusal headline, never a generic failure', () => {
    renderScreen();

    expect(screen.getByRole('alert')).toHaveTextContent('NO ENTREGAR');
    expect(document.body.textContent?.toLowerCase()).not.toContain('operación fallida');
  });

  it('is announced as an alert, not only coloured', () => {
    renderScreen();

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('there is no way back', () => {
  // docs/04, docs/17: "No existe botón de reapertura sobre una receta
  // dispensada." Asserted over every button's accessible name.
  it('renders no control that reopens, undoes, voids or reverts', () => {
    renderScreen();

    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toHaveAccessibleName(/reabrir|deshacer|anular|revertir/i);
    }
  });

  it('offers exactly one onward action, and it is the next prescription', () => {
    const { onScanAnother } = renderScreen();
    const buttons = screen.getAllByRole('button');

    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(/escanear otra receta/i);
    expect(onScanAnother).not.toHaveBeenCalled();
  });

  it('states that a dispensed prescription is never re-enabled anywhere', () => {
    renderScreen();

    expect(document.body.textContent).toMatch(/única y definitiva/i);
  });
});

describe('hard rules of docs/03', () => {
  it('never renders the patient identifier or the salt', () => {
    renderScreen();

    expect(document.body.textContent).not.toContain(aDocument().patient.patientId);
    expect(document.body.textContent).not.toContain(SALT);
  });
});
