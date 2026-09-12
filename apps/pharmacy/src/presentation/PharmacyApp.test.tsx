import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { encodeQrPayload, type Address } from '@recetas/shared';
import { CHECK_ORDER } from '../domain/verification';
import type { DispenseReceipt } from '../ports/chain.port';
import type { SignerPort } from '../ports/signer.port';
import {
  CHAIN_ID,
  CREDENTIAL_UID,
  DISPENSED_AT,
  PHARMACY_A,
  PHARMACY_B,
  REGISTRY_ADDRESS,
  SALT,
  aDocument,
  aQrPayload,
  aRecord,
} from '../test/fixtures';
import type { ScannerControls, ScannerStarter } from './camera/qr-scanner';
import type { PharmacyServices } from './composition/pharmacy-services';
import { PharmacyApp } from './PharmacyApp';

/**
 * End-to-end through the flow machine, with fake use cases.
 *
 * The rule under test is the one the whole product rests on: verification never
 * dispenses, and the write happens only after a deliberate human confirmation
 * (docs/17, P4).
 */

const RECEIPT: DispenseReceipt = {
  transactionHash: '0xabc0000000000000000000000000000000000000000000000000000000000001',
  blockNumber: 4_210_001n,
  blockTimestamp: DISPENSED_AT,
  dispensedBy: PHARMACY_A,
};

function fakeSigner(): SignerPort {
  return {
    isAvailable: () => true,
    getAccount: async () => PHARMACY_A,
    connect: async () => PHARMACY_A,
    getChainId: async () => CHAIN_ID,
    ensureChain: async () => undefined,
    getProvider: () => undefined,
  };
}

function fakeCamera(): { starter: ScannerStarter; emit(text: string): void } {
  const track = { stop: vi.fn(), kind: 'video' };
  const controls: ScannerControls = { stop: vi.fn() };
  let emit: (text: string) => void = () => undefined;

  return {
    starter: async (video, onText) => {
      (video as unknown as { srcObject: unknown }).srcObject = {
        getTracks: () => [track],
        getVideoTracks: () => [track],
      };
      emit = onText;
      return controls;
    },
    emit: (text) => emit(text),
  };
}

function buildServices(overrides: Partial<PharmacyServices> = {}): PharmacyServices {
  return {
    config: {
      apiUrl: 'http://localhost:3000',
      rpcUrl: 'http://localhost:8545',
      chainId: CHAIN_ID,
      registryAddress: REGISTRY_ADDRESS as Address,
    },
    signer: fakeSigner(),
    checkCredential: async ({ account }) => ({ accredited: true, account, uid: CREDENTIAL_UID }),
    verify: async () => ({
      outcome: 'dispensable',
      document: aDocument(),
      record: aRecord(),
      checks: CHECK_ORDER.map((id) => ({ id, state: 'passed' as const })),
    }),
    dispense: async () => ({ outcome: 'dispensed', receipt: RECEIPT }),
    ...overrides,
  };
}

/** Drives P1 -> P2 -> P3 -> P4 and stops there. */
async function reachVerifiedScreen(services: PharmacyServices) {
  const camera = fakeCamera();
  const user = userEvent.setup();

  render(<PharmacyApp services={services} startScanner={camera.starter} />);

  await waitFor(() => expect(screen.getByRole('button', { name: /escanear receta/i })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: /escanear receta/i }));

  await waitFor(() => expect(screen.getByLabelText(/vista de la cámara/i)).toBeInTheDocument());
  act(() => camera.emit(encodeQrPayload(aQrPayload())));

  await waitFor(() =>
    expect(screen.getByRole('button', { name: /^confirmar entrega$/i })).toBeInTheDocument(),
  );

  return { user, camera };
}

describe('verification never dispenses by itself', () => {
  it('reaches P4 without ever calling dispense', async () => {
    const dispense = vi.fn(async () => ({ outcome: 'dispensed' as const, receipt: RECEIPT }));
    await reachVerifiedScreen(buildServices({ dispense }));

    expect(dispense).not.toHaveBeenCalled();
  });

  it('still has not dispensed after the first press of "Confirmar entrega"', async () => {
    const dispense = vi.fn(async () => ({ outcome: 'dispensed' as const, receipt: RECEIPT }));
    const { user } = await reachVerifiedScreen(buildServices({ dispense }));

    await user.click(screen.getByRole('button', { name: /^confirmar entrega$/i }));

    expect(dispense).not.toHaveBeenCalled();
  });

  it('dispenses only after the explicit confirmation, then shows the receipt', async () => {
    const dispense = vi.fn(async () => ({ outcome: 'dispensed' as const, receipt: RECEIPT }));
    const { user } = await reachVerifiedScreen(buildServices({ dispense }));

    await user.click(screen.getByRole('button', { name: /^confirmar entrega$/i }));
    await user.click(screen.getByRole('button', { name: /sí, registrar la entrega/i }));

    await waitFor(() => expect(dispense).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/entregada/i),
    );
    expect(screen.getByText(RECEIPT.transactionHash)).toBeInTheDocument();
  });

  it('passes the pharmacy account the credential check accepted', async () => {
    const dispense = vi.fn(async () => ({ outcome: 'dispensed' as const, receipt: RECEIPT }));
    const { user } = await reachVerifiedScreen(buildServices({ dispense }));

    await user.click(screen.getByRole('button', { name: /^confirmar entrega$/i }));
    await user.click(screen.getByRole('button', { name: /sí, registrar la entrega/i }));

    await waitFor(() =>
      expect(dispense).toHaveBeenCalledWith(
        expect.objectContaining({ pharmacy: PHARMACY_A, expiresAt: aRecord().expiresAt }),
      ),
    );
  });
});

describe('the second scan of the same code', () => {
  it('lands on P6, naming who dispensed it and when', async () => {
    const camera = fakeCamera();
    const user = userEvent.setup();
    const services = buildServices({
      verify: async () => ({
        outcome: 'rejected',
        reason: {
          code: 'already-dispensed',
          dispensedBy: PHARMACY_B,
          dispensedAt: DISPENSED_AT,
        },
        checks: CHECK_ORDER.map((id, index) => ({
          id,
          state: index === 0 ? ('passed' as const) : index === 1 ? ('failed' as const) : ('skipped' as const),
        })),
      }),
    });

    render(<PharmacyApp services={services} startScanner={camera.starter} />);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /escanear receta/i })).toBeEnabled(),
    );
    await user.click(screen.getByRole('button', { name: /escanear receta/i }));
    await waitFor(() => expect(screen.getByLabelText(/vista de la cámara/i)).toBeInTheDocument());
    act(() => camera.emit(encodeQrPayload(aQrPayload())));

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('NO ENTREGAR'),
    );
    expect(document.body.textContent).toMatch(/09:42/);
    for (const button of screen.getAllByRole('button')) {
      expect(button).not.toHaveAccessibleName(/reabrir|deshacer|anular|revertir/i);
    }
  });
});

describe('an unmodelled failure is not dressed up as a verdict', () => {
  it('reports an incomplete operation when dispense rethrows', async () => {
    const { user } = await reachVerifiedScreen(
      buildServices({
        dispense: async () => {
          throw new Error('the RPC returned something nobody modelled');
        },
      }),
    );

    await user.click(screen.getByRole('button', { name: /^confirmar entrega$/i }));
    await user.click(screen.getByRole('button', { name: /sí, registrar la entrega/i }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'VERIFICACIÓN INCOMPLETA',
      ),
    );
    expect(document.body.textContent?.toLowerCase()).not.toContain('operación fallida');
  });

  it('returns to P4 intact when the person declines the prompt', async () => {
    const { user } = await reachVerifiedScreen(
      buildServices({ dispense: async () => ({ outcome: 'aborted' }) }),
    );

    await user.click(screen.getByRole('button', { name: /^confirmar entrega$/i }));
    await user.click(screen.getByRole('button', { name: /sí, registrar la entrega/i }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^confirmar entrega$/i })).toBeInTheDocument(),
    );
  });
});

describe('nothing about the flow reaches the URL', () => {
  // docs/17 and packages/shared/src/qr.ts: the QR carries the decryption key.
  it('leaves the address bar untouched through the whole flow', async () => {
    const before = window.location.href;
    const { user } = await reachVerifiedScreen(buildServices());

    await user.click(screen.getByRole('button', { name: /^confirmar entrega$/i }));
    await user.click(screen.getByRole('button', { name: /sí, registrar la entrega/i }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/entregada/i),
    );

    expect(window.location.href).toBe(before);
    expect(window.location.href).not.toContain(aQrPayload().key);
  });
});

describe('hard rules of docs/03 across the flow', () => {
  it('never renders the patient identifier or the salt on P4 or P5', async () => {
    const { user } = await reachVerifiedScreen(buildServices());

    expect(document.body.textContent).not.toContain(aDocument().patient.patientId);
    expect(document.body.textContent).not.toContain(SALT);

    await user.click(screen.getByRole('button', { name: /^confirmar entrega$/i }));
    await user.click(screen.getByRole('button', { name: /sí, registrar la entrega/i }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/entregada/i),
    );

    expect(document.body.textContent).not.toContain(aDocument().patient.patientId);
    expect(document.body.textContent).not.toContain(SALT);
  });
});
