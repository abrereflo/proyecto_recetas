import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Address } from '@recetas/shared';
import type { PharmacyConfig } from '../../infrastructure/config/env';
import {
  KEYSTORE_STORAGE_KEY,
  encryptPrivateKey,
  serialiseKeystore,
} from '../../infrastructure/signer/keystore';
import type { Eip1193Provider } from '../../ports/signer.port';
import { createPharmacyServices } from './pharmacy-services';

/**
 * Which signer the composition root picks, and why (docs/23).
 *
 * The rule is deliberately explicit rather than clever: a key stored on this
 * device wins, because someone put it there on purpose; otherwise an injected
 * provider wins, because that is the path docs/20 and docs/21 describe; and
 * with neither, the device-key path is offered so the pharmacist has a way in.
 */

const CONFIG: PharmacyConfig = {
  apiUrl: 'http://localhost:3000',
  rpcUrl: 'http://localhost:8545',
  chainId: 43113,
  registryAddress: '0x7777777777777777777777777777777777777777' as Address,
};

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

const injected: Eip1193Provider = { request: async () => null };

function withInjectedProvider(): void {
  Object.defineProperty(globalThis.window, 'ethereum', {
    value: injected,
    configurable: true,
    writable: true,
  });
}

function withoutInjectedProvider(): void {
  Reflect.deleteProperty(globalThis.window, 'ethereum');
}

beforeEach(() => {
  globalThis.localStorage.clear();
  withoutInjectedProvider();
});

afterEach(withoutInjectedProvider);

async function storeADeviceKey(): Promise<void> {
  const keystore = await encryptPrivateKey(TEST_PRIVATE_KEY, 'farmacia-central-2026');
  globalThis.localStorage.setItem(KEYSTORE_STORAGE_KEY, serialiseKeystore(keystore));
}

describe('choosing the signer', () => {
  it('uses the injected provider when there is one and this device has no key', () => {
    withInjectedProvider();

    const services = createPharmacyServices(CONFIG);

    expect(services.signer.getProvider()).toBe(injected);
    expect(services.deviceKey).toBeUndefined();
  });

  it('uses the device key when one is stored, even with an injected provider present', async () => {
    await storeADeviceKey();
    withInjectedProvider();

    const services = createPharmacyServices(CONFIG);

    expect(services.deviceKey).toBeDefined();
    expect(services.deviceKey?.hasKey()).toBe(true);
    expect(services.signer.getProvider()).not.toBe(injected);
    expect(services.signer.isAvailable()).toBe(true);
  });

  // The whole point of docs/23: a plain browser on a phone, where the injected
  // provider's own browser is what blocked the camera.
  it('offers the device-key path when there is no injected provider and no key yet', () => {
    const services = createPharmacyServices(CONFIG);

    expect(services.deviceKey).toBeDefined();
    expect(services.deviceKey?.hasKey()).toBe(false);
    expect(services.deviceKey?.isUnlocked()).toBe(false);
  });
});
