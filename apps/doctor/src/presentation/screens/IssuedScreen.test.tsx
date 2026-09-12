import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QR_DISCLOSURE_WARNING_ES } from '../../domain/issuance';
import {
  CHAIN_ID,
  CONTENT_HASH,
  EXPIRES_AT,
  POINTER,
  REGISTRY_ADDRESS,
  TRANSACTION_HASH,
  aDraft,
} from '../../test/fixtures';
import type { IssuedPrescription } from '../flow/doctor-flow';
import { formatDay } from '../format';
import { IssuedScreen } from './IssuedScreen';

/** D6 — Receta emitida y entrega del QR (docs/17). */

/** The DEK, base64url. This is the value D-24 is about. */
const KEY = 'WlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlpaWlo';

const RESULT: IssuedPrescription = {
  outcome: 'issued',
  qr: `RX1:${KEY}`,
  qrPayload: {
    v: 1,
    chainId: CHAIN_ID,
    registry: REGISTRY_ADDRESS,
    contentHash: CONTENT_HASH,
    pointer: POINTER,
    key: KEY,
  },
  contentHash: CONTENT_HASH,
  transactionHash: TRANSACTION_HASH,
  expiresAt: EXPIRES_AT,
};

async function renderScreen() {
  const onNewPrescription = vi.fn();
  const onOpenPrescriptions = vi.fn();

  render(
    <IssuedScreen
      chainId={CHAIN_ID}
      onNewPrescription={onNewPrescription}
      onOpenPrescriptions={onOpenPrescriptions}
      result={RESULT}
    />,
  );

  // The QR renders asynchronously; every assertion below is about the settled
  // screen, so it is awaited once here instead of in each test.
  await screen.findByRole('img', { name: /código qr/i });

  return { onNewPrescription, onOpenPrescriptions, user: userEvent.setup() };
}

describe('the code the patient carries', () => {
  it('renders a real QR drawn from the issued payload', async () => {
    await renderScreen();

    const code = screen.getByRole('img', { name: /código qr/i });
    const svg = code.querySelector('svg');

    expect(svg).not.toBeNull();
    // A QR is a grid of modules; a placeholder would have none.
    expect(svg?.querySelectorAll('path, rect').length ?? 0).toBeGreaterThan(0);
  });

  it('draws a different code for a different payload', async () => {
    const { rerender } = render(
      <IssuedScreen
        chainId={CHAIN_ID}
        onNewPrescription={vi.fn()}
        onOpenPrescriptions={vi.fn()}
        result={RESULT}
      />,
    );
    const first = (await screen.findByRole('img', { name: /código qr/i })).innerHTML;

    rerender(
      <IssuedScreen
        chainId={CHAIN_ID}
        onNewPrescription={vi.fn()}
        onOpenPrescriptions={vi.fn()}
        result={{ ...RESULT, qr: 'RX1:otro-contenido-completamente-distinto' }}
      />,
    );

    await waitFor(async () => {
      const second = (await screen.findByRole('img', { name: /código qr/i })).innerHTML;
      expect(second).not.toBe(first);
    });
  });
});

describe('D-24: whoever holds the code can read the prescription', () => {
  it('carries the warning verbatim, as an alert', async () => {
    await renderScreen();

    expect(screen.getByText(QR_DISCLOSURE_WARNING_ES)).toBeVisible();
  });

  it('states plainly that the code cannot be shown again', async () => {
    await renderScreen();

    expect(document.body.textContent).toMatch(/no se puede volver a mostrar/i);
    expect(document.body.textContent).toMatch(/no se puede generar de nuevo/i);
  });

  it('offers no action that implies the code can be recovered later', async () => {
    await renderScreen();

    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toHaveAccessibleName(/reenviar|recuperar|volver a enviar|descargar/i);
    }
  });
});

describe('D-13: the expiry is a day, not an instant', () => {
  it('renders the expiry date with no time', async () => {
    await renderScreen();

    expect(screen.getByText(formatDay(EXPIRES_AT))).toBeVisible();
    expect(document.body.textContent).not.toMatch(/\d{2}:\d{2}/);
  });
});

describe('hard rules of docs/03', () => {
  it('never renders the patient identifier', async () => {
    await renderScreen();

    expect(document.body.textContent).not.toContain(aDraft().patient.patientId);
  });

  it('never renders a commitment salt: the screen was never given one', async () => {
    await renderScreen();

    // The only 32-byte values here are the content hash and the transaction,
    // both of which are public on chain by design.
    const hexes = document.body.textContent?.match(/0x[0-9a-fA-F]{64}/g) ?? [];
    expect(new Set(hexes)).toEqual(new Set([CONTENT_HASH, TRANSACTION_HASH]));
  });
});

describe('the onward actions', () => {
  it('offers the next prescription and the list, and nothing else', async () => {
    await renderScreen();
    const names = screen.getAllByRole('button').map((button) => button.textContent);

    expect(names).toEqual(['Ver mis recetas', 'Escribir otra receta']);
  });

  it('starts a new prescription rather than editing this one', async () => {
    const { onNewPrescription, user } = await renderScreen();

    await user.click(screen.getByRole('button', { name: /escribir otra receta/i }));

    expect(onNewPrescription).toHaveBeenCalledOnce();
  });
});
