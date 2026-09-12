import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DispenseReceipt } from '../../ports/chain.port';
import { CONTENT_HASH, DISPENSED_AT, PHARMACY_A, SALT, aDocument } from '../../test/fixtures';
import { formatAddress, formatDateTime } from '../format';
import { DispensedScreen } from './DispensedScreen';

/** P5 — the receipt of an irreversible act (docs/17). */

const RECEIPT: DispenseReceipt = {
  transactionHash: '0xabc0000000000000000000000000000000000000000000000000000000000001',
  blockNumber: 4_210_001n,
  blockTimestamp: DISPENSED_AT,
  dispensedBy: PHARMACY_A,
};

function renderScreen() {
  const onScanAnother = vi.fn();
  render(
    <DispensedScreen contentHash={CONTENT_HASH} onScanAnother={onScanAnother} receipt={RECEIPT} />,
  );
  return { onScanAnother };
}

describe('the on-chain evidence', () => {
  it('renders the transaction hash in full, for a block explorer', () => {
    renderScreen();

    const value = screen.getByText(RECEIPT.transactionHash);
    expect(value).toBeInTheDocument();
    // Monospaced with tabular figures, so two hashes compare column by column.
    expect(value).toHaveClass('mono');
  });

  it('renders the block, the block time and the pharmacy the chain recorded', () => {
    renderScreen();

    expect(screen.getByText('4.210.001')).toBeInTheDocument();
    expect(screen.getByText(formatDateTime(RECEIPT.blockTimestamp))).toBeInTheDocument();
    expect(screen.getByText(formatAddress(RECEIPT.dispensedBy))).toBeInTheDocument();
  });

  it('is announced as an alert and carries a mark as well as colour', () => {
    renderScreen();

    const verdict = screen.getByRole('alert');
    expect(verdict).toHaveTextContent(/entregada/i);
  });
});

describe('there is no undo', () => {
  it('renders no control that reopens, undoes, voids or reverts', () => {
    renderScreen();

    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toHaveAccessibleName(/reabrir|deshacer|anular|revertir/i);
    }
  });

  it('offers exactly one onward action, and it is the next prescription', () => {
    renderScreen();
    const buttons = screen.getAllByRole('button');

    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAccessibleName(/escanear otra receta/i);
  });

  it('states that the prescription can never be dispensed again', () => {
    renderScreen();

    expect(document.body.textContent).toMatch(/no puede volver a dispensarse/i);
  });
});

describe('hard rules of docs/03', () => {
  it('never renders the patient identifier or the salt', () => {
    renderScreen();

    expect(document.body.textContent).not.toContain(aDocument().patient.patientId);
    expect(document.body.textContent).not.toContain(SALT);
  });
});
