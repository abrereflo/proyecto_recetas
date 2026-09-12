import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CONTENT_HASH, SALT, aDocument, aRecord } from '../../test/fixtures';
import { VerifiedPrescriptionScreen } from './VerifiedPrescriptionScreen';

/**
 * docs/17, P4: "Confirmar entrega es un acto humano, no un efecto secundario
 * del escaneo." docs/03: the patient identifier and the commitment salt never
 * reach the DOM.
 */

function renderScreen(overrides: { onConfirm?: () => void; onCancel?: () => void } = {}) {
  const onConfirm = overrides.onConfirm ?? vi.fn();
  const onCancel = overrides.onCancel ?? vi.fn();

  render(
    <VerifiedPrescriptionScreen
      contentHash={CONTENT_HASH}
      document={aDocument()}
      onCancel={onCancel}
      onConfirm={onConfirm}
      record={aRecord()}
    />,
  );

  return { onConfirm, onCancel };
}

describe('confirming the delivery is a deliberate act', () => {
  it('does not dispense on render', () => {
    const { onConfirm } = renderScreen();

    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('does not dispense on the first press either: it opens a confirmation', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderScreen();

    await user.click(screen.getByRole('button', { name: /^confirmar entrega$/i }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/confirme la entrega del medicamento/i)).toBeInTheDocument();
  });

  it('dispenses only after the explicit confirmation', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderScreen();

    await user.click(screen.getByRole('button', { name: /^confirmar entrega$/i }));
    await user.click(screen.getByRole('button', { name: /sí, registrar la entrega/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('says out loud that the registration is definitive before asking', async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole('button', { name: /^confirmar entrega$/i }));

    expect(screen.getByRole('alert')).toHaveTextContent(/definitiva/i);
  });

  it('lets the pharmacist step back out of the confirmation', async () => {
    const user = userEvent.setup();
    const { onConfirm } = renderScreen();

    await user.click(screen.getByRole('button', { name: /^confirmar entrega$/i }));
    await user.click(screen.getByRole('button', { name: /^volver$/i }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^confirmar entrega$/i })).toBeInTheDocument();
  });

  it('cancels without registering anything', async () => {
    const user = userEvent.setup();
    const { onCancel, onConfirm } = renderScreen();

    await user.click(screen.getByRole('button', { name: /^cancelar$/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('the decrypted content', () => {
  it('renders every prescribed item in full', () => {
    renderScreen();
    const item = aDocument().items[0];
    if (item === undefined) throw new Error('fixture has no items');

    expect(screen.getByText(new RegExp(item.activeIngredient, 'i'))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(item.atcCode, 'i'))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(item.dosageInstruction, 'i'))).toBeInTheDocument();
  });

  it('names the prescriber and the validity window', () => {
    renderScreen();

    expect(screen.getByText(/dra\. prueba/i)).toBeInTheDocument();
    expect(screen.getByText(/MED-0000-XX/)).toBeInTheDocument();
    expect(screen.getByText(/caduca el/i)).toBeInTheDocument();
  });
});

describe('hard rules of docs/03', () => {
  it('never renders the patient identifier', () => {
    renderScreen();

    expect(document.body.textContent).not.toContain(aDocument().patient.patientId);
  });

  it('never renders the commitment salt', () => {
    renderScreen();

    expect(document.body.textContent).not.toContain(SALT);
  });
});
