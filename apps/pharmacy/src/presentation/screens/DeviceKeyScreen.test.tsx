import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Address } from '@recetas/shared';
import type { DeviceKeyPort } from '../../ports/device-key.port';
import { PHARMACY_A } from '../../test/fixtures';
import { DeviceKeyScreen } from './DeviceKeyScreen';

/**
 * P0 — the screen that exists only when the pharmacy signs from the device
 * itself (docs/23-firma-en-el-dispositivo.md).
 *
 * It sits BEFORE P1 and changes nothing about it: once the key is open, the
 * access screen runs exactly the check it always ran.
 */

const PASSPHRASE = 'farmacia-central-2026';
const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

function fakeDeviceKey(overrides: Partial<DeviceKeyPort> = {}): DeviceKeyPort {
  let unlocked = false;
  let stored = false;

  return {
    hasKey: () => stored,
    isUnlocked: () => unlocked,
    async enrol() {
      stored = true;
      unlocked = true;
      return PHARMACY_A;
    },
    async unlock() {
      unlocked = true;
      return PHARMACY_A;
    },
    lock() {
      unlocked = false;
    },
    forget() {
      stored = false;
      unlocked = false;
    },
    ...overrides,
  };
}

function renderScreen(deviceKey: DeviceKeyPort) {
  const onUnlocked = vi.fn<(account: Address) => void>();
  render(<DeviceKeyScreen deviceKey={deviceKey} onUnlocked={onUnlocked} />);
  return { onUnlocked, user: userEvent.setup() };
}

function keyField(): HTMLElement {
  return screen.getByLabelText(/clave de firma/i);
}

function passphraseField(): HTMLElement {
  return screen.getByLabelText(/contraseña de este dispositivo/i);
}

describe('a device that has no key yet', () => {
  it('asks for the key and for a passphrase, twice', () => {
    renderScreen(fakeDeviceKey());

    expect(keyField()).toBeInTheDocument();
    expect(passphraseField()).toBeInTheDocument();
    expect(screen.getByLabelText(/repita la contraseña/i)).toBeInTheDocument();
  });

  // The honest warning this screen exists to carry (docs/23).
  it('says out loud that the key stays on this device and must not hold real funds', () => {
    renderScreen(fakeDeviceKey());
    const text = (document.body.textContent ?? '').toLowerCase();

    expect(text).toContain('en este dispositivo');
    expect(text).toMatch(/cifrad/);
    expect(text).toMatch(/fondos reales/);
  });

  it('hides what is typed into the key field', () => {
    renderScreen(fakeDeviceKey());

    expect(keyField()).toHaveAttribute('type', 'password');
  });

  it('stores the key and reports the account once both passphrases agree', async () => {
    const deviceKey = fakeDeviceKey();
    const enrol = vi.spyOn(deviceKey, 'enrol');
    const { onUnlocked, user } = renderScreen(deviceKey);

    await user.type(keyField(), TEST_PRIVATE_KEY);
    await user.type(passphraseField(), PASSPHRASE);
    await user.type(screen.getByLabelText(/repita la contraseña/i), PASSPHRASE);
    await user.click(screen.getByRole('button', { name: /guardar y continuar/i }));

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledWith(PHARMACY_A));
    expect(enrol).toHaveBeenCalledWith(TEST_PRIVATE_KEY, PASSPHRASE);
  });
});

describe('the passphrase rules are checked before anything is encrypted', () => {
  it('refuses a passphrase shorter than twelve characters', async () => {
    const deviceKey = fakeDeviceKey();
    const enrol = vi.spyOn(deviceKey, 'enrol');
    const { onUnlocked, user } = renderScreen(deviceKey);

    await user.type(keyField(), TEST_PRIVATE_KEY);
    await user.type(passphraseField(), 'corta123');
    await user.type(screen.getByLabelText(/repita la contraseña/i), 'corta123');
    await user.click(screen.getByRole('button', { name: /guardar y continuar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/12 caracteres/i);
    expect(enrol).not.toHaveBeenCalled();
    expect(onUnlocked).not.toHaveBeenCalled();
  });

  it('refuses two passphrases that do not match', async () => {
    const deviceKey = fakeDeviceKey();
    const enrol = vi.spyOn(deviceKey, 'enrol');
    const { user } = renderScreen(deviceKey);

    await user.type(keyField(), TEST_PRIVATE_KEY);
    await user.type(passphraseField(), PASSPHRASE);
    await user.type(screen.getByLabelText(/repita la contraseña/i), `${PASSPHRASE}x`);
    await user.click(screen.getByRole('button', { name: /guardar y continuar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/no coinciden/i);
    expect(enrol).not.toHaveBeenCalled();
  });

  it('reports a key the adapter refuses, in words, without losing the screen', async () => {
    const deviceKey = fakeDeviceKey({
      enrol: async () => {
        throw new Error('La clave de firma no tiene el formato esperado.');
      },
    });
    const { onUnlocked, user } = renderScreen(deviceKey);

    await user.type(keyField(), 'no es una clave');
    await user.type(passphraseField(), PASSPHRASE);
    await user.type(screen.getByLabelText(/repita la contraseña/i), PASSPHRASE);
    await user.click(screen.getByRole('button', { name: /guardar y continuar/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/formato esperado/i);
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(keyField()).toBeInTheDocument();
  });
});

describe('a device that already has a key', () => {
  function enrolled(overrides: Partial<DeviceKeyPort> = {}): DeviceKeyPort {
    return fakeDeviceKey({ hasKey: () => true, ...overrides });
  }

  it('asks only for the passphrase', () => {
    renderScreen(enrolled());

    expect(passphraseField()).toBeInTheDocument();
    expect(screen.queryByLabelText(/clave de firma/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/repita la contraseña/i)).not.toBeInTheDocument();
  });

  it('opens the key and reports the account', async () => {
    const deviceKey = enrolled();
    const unlock = vi.spyOn(deviceKey, 'unlock');
    const { onUnlocked, user } = renderScreen(deviceKey);

    await user.type(passphraseField(), PASSPHRASE);
    await user.click(screen.getByRole('button', { name: /^desbloquear$/i }));

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledWith(PHARMACY_A));
    expect(unlock).toHaveBeenCalledWith(PASSPHRASE);
  });

  it('says the passphrase is wrong and stays on the screen', async () => {
    const deviceKey = enrolled({
      unlock: async () => {
        throw new Error('La contraseña no abre la clave guardada en este dispositivo.');
      },
    });
    const { onUnlocked, user } = renderScreen(deviceKey);

    await user.type(passphraseField(), 'incorrecta1234');
    await user.click(screen.getByRole('button', { name: /^desbloquear$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/contraseña/i);
    expect(onUnlocked).not.toHaveBeenCalled();
    expect(passphraseField()).toBeInTheDocument();
  });
});

describe('erasing the key from the device', () => {
  it('asks for confirmation before erasing anything', async () => {
    const deviceKey = fakeDeviceKey({ hasKey: () => true });
    const forget = vi.spyOn(deviceKey, 'forget');
    const { user } = renderScreen(deviceKey);

    await user.click(screen.getByRole('button', { name: /borrar la clave/i }));

    expect(forget).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /sí, borrar/i })).toBeInTheDocument();
  });

  it('erases it on confirmation and asks for a new key', async () => {
    let stored = true;
    const deviceKey = fakeDeviceKey({
      hasKey: () => stored,
      forget: () => {
        stored = false;
      },
    });
    const { user } = renderScreen(deviceKey);

    await user.click(screen.getByRole('button', { name: /borrar la clave/i }));
    await user.click(screen.getByRole('button', { name: /sí, borrar/i }));

    await waitFor(() => expect(keyField()).toBeInTheDocument());
    expect(stored).toBe(false);
  });

  it('can be called off', async () => {
    const deviceKey = fakeDeviceKey({ hasKey: () => true });
    const forget = vi.spyOn(deviceKey, 'forget');
    const { user } = renderScreen(deviceKey);

    await user.click(screen.getByRole('button', { name: /borrar la clave/i }));
    await user.click(screen.getByRole('button', { name: /^cancelar$/i }));

    expect(forget).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /sí, borrar/i })).not.toBeInTheDocument();
  });
});

describe('copy', () => {
  it('never uses crypto-product vocabulary', () => {
    renderScreen(fakeDeviceKey());
    const text = (document.body.textContent ?? '').toLowerCase();

    for (const forbidden of ['wallet', 'frase semilla', 'saldo']) {
      expect(text).not.toContain(forbidden);
    }
  });
});
