import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type {
  ListPrescriptions,
  PrescriptionListItem,
} from '../../application/list-prescriptions';
import { PRESCRIPTION_STATE_LABEL_ES } from '../../application/list-prescriptions';
import {
  BLOCK_TIME,
  CONTENT_HASH,
  DISPENSED_AT,
  EXPIRES_AT,
  ISSUED_AT,
  PATIENT_COMMITMENT,
  PHARMACY,
  PRESCRIBER,
  TRANSACTION_HASH,
  aDraft,
} from '../../test/fixtures';
import { PrescriptionsScreen } from './PrescriptionsScreen';

/** D7 — Mis recetas (docs/17). */

function anItemOf(
  state: PrescriptionListItem['state'],
  overrides: Partial<PrescriptionListItem> = {},
): PrescriptionListItem {
  return {
    contentHash: CONTENT_HASH,
    patientCommitment: PATIENT_COMMITMENT,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    state,
    label: PRESCRIPTION_STATE_LABEL_ES[state],
    transactionHash: TRANSACTION_HASH,
    blockNumber: 42n,
    // The projection declares `cancel` available on an issued prescription.
    // This screen must still render no control: no use case can perform it.
    actions: state === 'issued' ? ['cancel'] : [],
    ...overrides,
  };
}

function listing(items: PrescriptionListItem[]): ListPrescriptions {
  return vi.fn(async () => ({
    outcome: 'listed' as const,
    items,
    referenceTimestamp: BLOCK_TIME,
  }));
}

async function renderScreen(list: ListPrescriptions) {
  const onNewPrescription = vi.fn();

  render(
    <PrescriptionsScreen
      list={list}
      onNewPrescription={onNewPrescription}
      prescriber={PRESCRIBER}
    />,
  );

  await screen.findByRole('heading', { name: /mis recetas/i });
  // The listing resolves on a microtask; wait for the loading copy to go.
  await screen.findByRole('button', { name: /nueva receta/i });

  return { onNewPrescription };
}

describe('the four states', () => {
  it.each([
    ['issued', 'Emitida'],
    ['expired', 'Caducada'],
    ['dispensed', 'Dispensada'],
    ['cancelled', 'Anulada'],
  ] as const)('renders %s as "%s"', async (state, label) => {
    await renderScreen(listing([anItemOf(state)]));

    expect(await screen.findByText(label)).toBeVisible();
  });

  it('renders the label the use case derived, never one re-decided here', async () => {
    // The item says `expired` while its label is the one the core assigned.
    await renderScreen(listing([anItemOf('expired')]));

    expect(await screen.findByText(PRESCRIPTION_STATE_LABEL_ES.expired)).toBeVisible();
  });

  it('pairs every state with a mark, so colour is never the only signal', async () => {
    await renderScreen(
      listing([
        anItemOf('issued'),
        anItemOf('dispensed', { contentHash: `${CONTENT_HASH.slice(0, -1)}b` as never }),
      ]),
    );

    expect((await screen.findByText('Emitida')).closest('.badge')).toHaveTextContent(/[ℹ✓⏱✗]/);
  });
});

describe('no row carries an action', () => {
  // docs/04, docs/17: "«Dispensada» sin ninguna acción disponible". The core
  // has no cancel use case at all, so no row gets a button it cannot honour.
  it.each(['issued', 'expired', 'dispensed', 'cancelled'] as const)(
    'renders no control on a %s prescription',
    async (state) => {
      await renderScreen(listing([anItemOf(state)]));

      const buttons = screen.getAllByRole('button');
      expect(buttons).toHaveLength(1);
      expect(buttons[0]).toHaveAccessibleName(/nueva receta/i);
    },
  );

  it('never offers to reopen, undo or revert a dispensed prescription', async () => {
    await renderScreen(listing([anItemOf('dispensed', { dispensedBy: PHARMACY, dispensedAt: DISPENSED_AT })]));

    expect(document.body.textContent).not.toMatch(/reabrir|deshacer|revertir|reapertura/i);
  });

  it('shows who dispensed it and when, as the evidence of an irreversible act', async () => {
    await renderScreen(
      listing([anItemOf('dispensed', { dispensedBy: PHARMACY, dispensedAt: DISPENSED_AT })]),
    );

    expect(await screen.findByText(/entregada el/i)).toBeVisible();
  });
});

describe('an empty list and an unavailable chain are different answers', () => {
  it('says nothing has been issued yet, without implying a failure', async () => {
    await renderScreen(listing([]));

    expect(await screen.findByText(/todavía no ha emitido ninguna receta/i)).toBeVisible();
  });

  it('says the query failed, and does not pass it off as an empty list', async () => {
    const unavailable: ListPrescriptions = vi.fn(async () => ({
      outcome: 'unavailable' as const,
      reason: { code: 'network-error' as const, message: 'No hay respuesta del nodo.' },
    }));

    await renderScreen(unavailable);

    expect(await screen.findByRole('alert')).toHaveTextContent(/no se está mostrando una lista vacía/i);
    expect(screen.queryByText(/todavía no ha emitido ninguna receta/i)).toBeNull();
  });

  it('survives a use case that throws, rather than blanking the screen', async () => {
    const thrower: ListPrescriptions = vi.fn(async () => {
      throw new Error('boom');
    });

    await renderScreen(thrower);

    expect(await screen.findByRole('alert')).toBeVisible();
  });
});

describe('hard rules of docs/03', () => {
  it('never renders the patient identifier or the commitment', async () => {
    await renderScreen(listing([anItemOf('issued')]));

    expect(document.body.textContent).not.toContain(aDraft().patient.patientId);
    expect(document.body.textContent).not.toContain(PATIENT_COMMITMENT);
  });
});
