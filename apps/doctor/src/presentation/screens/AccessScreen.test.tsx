import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Address } from '@recetas/shared';
import type { CheckCredential } from '../../application/check-credential';
import type { SignerPort } from '../../ports/signer.port';
import { CHAIN_ID, CREDENTIAL_UID, PRESCRIBER } from '../../test/fixtures';
import { AccessScreen } from './AccessScreen';

/** D1 — Acceso (docs/17). */

function aSigner(overrides: Partial<SignerPort> = {}): SignerPort {
  return {
    isAvailable: () => true,
    getAccount: async () => PRESCRIBER,
    connect: async () => PRESCRIBER,
    getChainId: async () => CHAIN_ID,
    ensureChain: async () => undefined,
    getProvider: () => undefined,
    signPrescription: async () => `0x${'ab'.repeat(65)}`,
    ...overrides,
  };
}

const ACCREDITED: CheckCredential = async ({ account }) => ({
  accredited: true,
  account,
  uid: CREDENTIAL_UID,
});

const REFUSED: CheckCredential = async ({ account }) => ({
  accredited: false,
  account,
  reason: { code: 'practitioner-credential-missing', account },
});

function renderScreen(signer: SignerPort, checkCredential: CheckCredential) {
  const onAccredited = vi.fn<(account: Address) => void>();

  render(
    <AccessScreen
      chainId={CHAIN_ID}
      checkCredential={checkCredential}
      onAccredited={onAccredited}
      signer={signer}
    />,
  );

  return { onAccredited, user: userEvent.setup() };
}

describe('nothing is reachable until the credential has been checked', () => {
  it('starts with the only onward control disabled', async () => {
    renderScreen(aSigner({ getAccount: async () => null }), ACCREDITED);

    // The silent check on mount finds no authorised account and settles back
    // on the manual one; the onward control never became pressable.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /comprobar credencial/i })).toBeEnabled(),
    );
    expect(screen.getByRole('button', { name: /escribir una receta/i })).toBeDisabled();
  });

  it('keeps it disabled when the credential is refused', async () => {
    renderScreen(aSigner(), REFUSED);

    await screen.findByRole('alert');
    expect(screen.getByRole('button', { name: /escribir una receta/i })).toBeDisabled();
  });

  it('enables it only once the check has passed', async () => {
    renderScreen(aSigner(), ACCREDITED);

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /escribir una receta/i })).toBeEnabled(),
    );
  });

  it('hands the checked account onward, and nothing else does', async () => {
    const { onAccredited, user } = renderScreen(aSigner(), ACCREDITED);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /escribir una receta/i })).toBeEnabled(),
    );

    await user.click(screen.getByRole('button', { name: /escribir una receta/i }));

    expect(onAccredited).toHaveBeenCalledWith(PRESCRIBER);
  });
});

describe('the vocabulary of a clinical tool', () => {
  // docs/17: "No aparece la palabra «wallet», ni frase semilla, ni saldo."
  it.each(['wallet', 'frase semilla', 'saldo'])(
    'never shows the word "%s"',
    (forbidden) => {
      renderScreen(aSigner({ isAvailable: () => false }), ACCREDITED);

      expect(document.body.textContent?.toLowerCase()).not.toContain(forbidden);
    },
  );

  it('calls it a professional credential', () => {
    renderScreen(aSigner({ isAvailable: () => false }), ACCREDITED);

    expect(document.body.textContent).toMatch(/credencial profesional/i);
  });
});

describe('a registered credential is not a valid one', () => {
  it('says registered, never valid', async () => {
    renderScreen(aSigner(), ACCREDITED);
    await screen.findAllByText(/registrada/i);

    expect(document.body.textContent).not.toMatch(/credencial (vigente|válida)/i);
  });

  it('says the vigency is checked again at each issuance', async () => {
    renderScreen(aSigner(), ACCREDITED);

    expect(
      await screen.findByText(/su vigencia se comprueba de nuevo en el momento de emitir/i),
    ).toBeVisible();
  });

  it('never says anything already issued is deleted when a credential lapses', async () => {
    renderScreen(aSigner(), REFUSED);
    await screen.findByRole('alert');

    expect(document.body.textContent).toMatch(/las recetas ya emitidas siguen en la cadena/i);
  });
});

describe('a device with no credential at all', () => {
  it('says so, and offers no check to run', () => {
    renderScreen(aSigner({ isAvailable: () => false }), ACCREDITED);

    expect(screen.getByRole('alert')).toHaveTextContent(/no tiene credencial profesional/i);
    expect(screen.queryByRole('button', { name: /comprobar credencial/i })).toBeNull();
  });
});

describe('the device is moved to the registry chain before anything is checked', () => {
  it('asks the signer for the configured chain', async () => {
    const ensureChain = vi.fn(async () => undefined);
    renderScreen(aSigner({ ensureChain }), ACCREDITED);

    await waitFor(() => expect(ensureChain).toHaveBeenCalledWith(CHAIN_ID));
  });
});
