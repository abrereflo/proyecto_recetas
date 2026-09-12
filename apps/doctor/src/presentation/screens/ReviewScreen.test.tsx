import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ADSIB_PENDING_NOTICE_ES } from '../../domain/issuance';
import { expiresAtMidnight } from '../../domain/draft';
import { CHAIN_ID, ISSUED_AT_DATE, PRESCRIBER, aDraft, anItem } from '../../test/fixtures';
import { formatDay } from '../format';
import { ReviewScreen } from './ReviewScreen';

/** D5 — Firma EIP-712 (docs/17). */

const DRAFT = aDraft({
  patient: { patientId: 'CI-7418529', fullName: 'Lucía Vargas Antelo', birthDate: '1991-03-14' },
  practitioner: { licenseNumber: 'MED-7741-SC', fullName: 'Dr. Roberto Méndez Salazar' },
  items: [anItem({ activeIngredient: 'amoxicilina' })],
});

function renderScreen(draft = DRAFT) {
  const onConfirmSignature = vi.fn();
  const onBack = vi.fn();

  render(
    <ReviewScreen
      chainId={CHAIN_ID}
      draft={draft}
      now={ISSUED_AT_DATE}
      onBack={onBack}
      onConfirmSignature={onConfirmSignature}
      prescriber={PRESCRIBER}
    />,
  );

  return { onConfirmSignature, onBack, user: userEvent.setup() };
}

describe('what is signed is rendered as sentences', () => {
  // docs/17, D5: "Datos tipados como frases legibles, nunca un hexadecimal."
  it('renders no raw 32-byte value anywhere on the screen', () => {
    renderScreen();

    expect(document.body.textContent).not.toMatch(/0x[0-9a-fA-F]{16,}/);
  });

  it('names every field of the typed message in plain words', () => {
    renderScreen();

    for (const field of [
      'Prescriptor',
      'Contenido de la receta',
      'Paciente',
      'Fecha de emisión',
      'Vigencia',
      'Número de firma',
      'Registro',
    ]) {
      expect(screen.getAllByText(field).length).toBeGreaterThan(0);
    }
  });

  it('says what the content hash commits to, instead of printing one', () => {
    renderScreen();

    expect(document.body.textContent).toMatch(/se cifra en este equipo antes de firmarse/i);
  });

  it('shows the expiry as a day, with no time (D-13)', () => {
    renderScreen();
    const expiresAt = expiresAtMidnight(ISSUED_AT_DATE, DRAFT.validityDays);

    expect(document.body.textContent).toContain(formatDay(expiresAt));
    expect(document.body.textContent).not.toMatch(/\d{2}:\d{2}/);
  });
});

describe('the ADSIB signature is declared and unintegrated (D-17)', () => {
  it('shows the pending-integration status verbatim', () => {
    renderScreen();

    expect(screen.getByText(/pending-integration/)).toBeVisible();
  });

  it('carries the notice the core owns, without softening it', () => {
    renderScreen();

    expect(screen.getByText(ADSIB_PENDING_NOTICE_ES)).toBeVisible();
  });

  it('never claims legal validity', () => {
    renderScreen();

    expect(document.body.textContent).not.toMatch(
      /validez legal|legalmente v[áa]lid|firma digital v[áa]lid/i,
    );
  });
});

describe('hard rules of docs/03', () => {
  it('never renders the patient identifier', () => {
    renderScreen();

    expect(document.body.textContent).not.toContain(DRAFT.patient.patientId);
  });

  it('renders no salt, because none exists before the pipeline runs', () => {
    renderScreen();

    expect(document.body.textContent).not.toMatch(/0x[0-9a-fA-F]{16,}/);
  });
});

describe('signing is an explicit act', () => {
  it('offers exactly one control that starts the issuance', async () => {
    const { onConfirmSignature, user } = renderScreen();

    await user.click(screen.getByRole('button', { name: /firmar y emitir/i }));

    expect(onConfirmSignature).toHaveBeenCalledOnce();
  });

  it('is never disabled by an alert', () => {
    renderScreen(
      aDraft({
        items: [anItem({ activeIngredient: 'amoxicilina' })],
        patientContext: { declaredAllergies: ['amoxicilina'], concomitantMedication: [] },
      }),
    );

    expect(screen.getByRole('button', { name: /firmar y emitir/i })).toBeEnabled();
  });
});
