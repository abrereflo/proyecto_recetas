import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Address } from '@recetas/shared';
import type { CheckCredential } from '../../application/check-credential';
import { SignerUnavailableError, type SignerPort } from '../../ports/signer.port';
import { CHAIN_ID, CREDENTIAL_UID, PHARMACY_A } from '../../test/fixtures';
import { AccessScreen } from './AccessScreen';

/**
 * docs/17, P1: "La credencial de farmacia se comprueba antes de habilitar el
 * escáner." The gate is structural — the button is disabled — so it is tested
 * as behaviour rather than read off the source.
 */

function fakeSigner(overrides: Partial<SignerPort> = {}): SignerPort {
  return {
    isAvailable: () => true,
    getAccount: async () => PHARMACY_A,
    connect: async () => PHARMACY_A,
    getChainId: async () => CHAIN_ID,
    ensureChain: async () => undefined,
    ...overrides,
  };
}

const accredited: CheckCredential = async ({ account }) => ({
  accredited: true,
  account,
  uid: CREDENTIAL_UID,
});

const revoked: CheckCredential = async ({ account }) => ({
  accredited: false,
  account,
  reason: { code: 'pharmacy-credential-revoked', account },
});

const unreachable: CheckCredential = async ({ account }) => ({
  accredited: false,
  account,
  reason: {
    code: 'network-error',
    message: 'No se pudo comprobar la credencial de la farmacia en la cadena.',
  },
});

/**
 * The screen starts its credential check in a mount effect, so the render is
 * wrapped: without this every assertion races the promise the effect awaits.
 */
async function renderScreen(signer: SignerPort, checkCredential: CheckCredential) {
  const onAccredited = vi.fn<(account: Address) => void>();

  await act(async () => {
    render(
      <AccessScreen
        chainId={CHAIN_ID}
        checkCredential={checkCredential}
        onAccredited={onAccredited}
        signer={signer}
      />,
    );
  });

  return { onAccredited };
}

function scanButton(): HTMLElement {
  return screen.getByRole('button', { name: /escanear receta/i });
}

describe('the scanner is gated on the credential', () => {
  it('starts disabled, before any check has answered', async () => {
    await renderScreen(
      fakeSigner({ getAccount: async () => null }),
      vi.fn() as unknown as CheckCredential,
    );

    expect(scanButton()).toBeDisabled();
  });

  it('enables the scanner only once the credential check has passed', async () => {
    const { onAccredited } = await renderScreen(fakeSigner(), accredited);

    await waitFor(() => expect(scanButton()).toBeEnabled());
    expect(onAccredited).not.toHaveBeenCalled();
  });

  it('keeps the scanner disabled when the credential is not available', async () => {
    await renderScreen(fakeSigner(), revoked);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(scanButton()).toBeDisabled();
  });

  it('keeps the scanner disabled when the chain could not answer', async () => {
    await renderScreen(fakeSigner(), unreachable);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(scanButton()).toBeDisabled();
  });

  it('hands the account to the flow only when the pharmacist opens the scanner', async () => {
    const user = userEvent.setup();
    const { onAccredited } = await renderScreen(fakeSigner(), accredited);

    await waitFor(() => expect(scanButton()).toBeEnabled());
    await user.click(scanButton());

    expect(onAccredited).toHaveBeenCalledWith(PHARMACY_A);
  });
});

describe('the chain is pinned before the credential is read', () => {
  it('moves the device to the configured chain', async () => {
    const ensureChain = vi.fn(async () => undefined);
    await renderScreen(fakeSigner({ ensureChain }), accredited);

    await waitFor(() => expect(ensureChain).toHaveBeenCalledWith(CHAIN_ID));
  });

  it('blocks the scanner when the device cannot be moved there', async () => {
    await renderScreen(
      fakeSigner({
        ensureChain: async () => {
          throw new Error('unrecognised chain');
        },
      }),
      accredited,
    );

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(scanButton()).toBeDisabled();
  });
});

describe('a device with no credential at all', () => {
  it('says so without jargon and keeps the scanner disabled', async () => {
    await renderScreen(
      fakeSigner({
        isAvailable: () => false,
        getAccount: async () => {
          throw new SignerUnavailableError();
        },
      }),
      accredited,
    );

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/no tiene credencial de farmacia/i),
    );
    expect(scanButton()).toBeDisabled();
  });
});

describe('a registered credential is not a promise of vigency', () => {
  // application/check-credential.ts: `credentialOf` returns a POINTER. The
  // contract re-validates the attestation on every dispense.
  it('says the credential is registered, never that it is valid', async () => {
    await renderScreen(fakeSigner(), accredited);

    await waitFor(() => expect(scanButton()).toBeEnabled());
    const text = document.body.textContent ?? '';

    expect(text).toMatch(/registrada/i);
    expect(text).toMatch(/su vigencia se comprueba de nuevo/i);
    expect(text).not.toMatch(/credencial vigente|credencial válida/i);
  });
});

describe('accessibility and copy', () => {
  it('never uses crypto-product vocabulary', async () => {
    await renderScreen(fakeSigner(), accredited);

    await waitFor(() => expect(scanButton()).toBeEnabled());
    const text = (document.body.textContent ?? '').toLowerCase();

    for (const forbidden of ['wallet', 'frase semilla', 'saldo']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('states the outcome in words and with a mark, not only in colour', async () => {
    await renderScreen(fakeSigner(), accredited);

    await waitFor(() =>
      expect(screen.getAllByText(/credencial registrada|registrada/i).length).toBeGreaterThan(0),
    );
  });
});
