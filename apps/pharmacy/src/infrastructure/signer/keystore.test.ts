import { beforeEach, describe, expect, it } from 'vitest';
import {
  InvalidPrivateKeyError,
  KEYSTORE_ITERATIONS,
  KEYSTORE_IV_BYTES,
  KEYSTORE_SALT_BYTES,
  KEYSTORE_STORAGE_KEY,
  KEYSTORE_VERSION,
  KeystoreCorruptError,
  KeystorePassphraseError,
  MINIMUM_PASSPHRASE_LENGTH,
  WeakPassphraseError,
  clearKeystore,
  decryptPrivateKey,
  encryptPrivateKey,
  hasKeystore,
  loadKeystore,
  normalisePrivateKey,
  parseKeystore,
  saveKeystore,
  serialiseKeystore,
} from './keystore';

/**
 * The encrypted device key, docs/23-firma-en-el-dispositivo.md.
 *
 * The key below is Anvil's first well-known development account. It is printed
 * by every Anvil boot and is public by construction, so it is safe in a
 * repository — which is exactly the rule this feature has to teach: the
 * keystore is scaffolding for a test account, never for an account holding
 * anything real (docs/08).
 */

const TEST_PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const PASSPHRASE = 'farmacia-central-2026';
const OTHER_PASSPHRASE = 'farmacia-central-2027';

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe('the private key is normalised before it is ever encrypted', () => {
  it('accepts a 0x-prefixed 32-byte key and lowercases it', () => {
    expect(normalisePrivateKey(TEST_PRIVATE_KEY.toUpperCase().replace('0X', '0x'))).toBe(
      TEST_PRIVATE_KEY,
    );
  });

  it('accepts the same key without the 0x prefix, and with surrounding spaces', () => {
    expect(normalisePrivateKey(`  ${TEST_PRIVATE_KEY.slice(2)}\n`)).toBe(TEST_PRIVATE_KEY);
  });

  it.each([
    ['empty', ''],
    ['too short', '0xac0974be'],
    ['too long', `${TEST_PRIVATE_KEY}ff`],
    ['not hexadecimal', `0x${'z'.repeat(64)}`],
  ])('refuses a key that is %s, with a named error', (_label, value) => {
    expect(() => normalisePrivateKey(value)).toThrow(InvalidPrivateKeyError);
  });
});

describe('encrypting and decrypting the device key', () => {
  it('returns the same key it was given', async () => {
    const keystore = await encryptPrivateKey(TEST_PRIVATE_KEY, PASSPHRASE);

    await expect(decryptPrivateKey(keystore, PASSPHRASE)).resolves.toBe(TEST_PRIVATE_KEY);
  });

  it('describes its own parameters, so a later version can migrate it', async () => {
    const keystore = await encryptPrivateKey(TEST_PRIVATE_KEY, PASSPHRASE);

    expect(keystore.version).toBe(KEYSTORE_VERSION);
    expect(keystore.kdf).toBe('PBKDF2-SHA256');
    expect(keystore.cipher).toBe('AES-GCM-256');
    expect(keystore.iterations).toBeGreaterThanOrEqual(310_000);
    expect(keystore.iterations).toBe(KEYSTORE_ITERATIONS);
  });

  it('derives from a random 16-byte salt and encrypts under a random 12-byte iv', async () => {
    const keystore = await encryptPrivateKey(TEST_PRIVATE_KEY, PASSPHRASE);

    expect(globalThis.atob(keystore.salt).length).toBe(KEYSTORE_SALT_BYTES);
    expect(globalThis.atob(keystore.iv).length).toBe(KEYSTORE_IV_BYTES);
    expect(KEYSTORE_SALT_BYTES).toBe(16);
    expect(KEYSTORE_IV_BYTES).toBe(12);
  });

  it('never produces the same ciphertext twice for the same key and passphrase', async () => {
    const first = await encryptPrivateKey(TEST_PRIVATE_KEY, PASSPHRASE);
    const second = await encryptPrivateKey(TEST_PRIVATE_KEY, PASSPHRASE);

    expect(first.salt).not.toBe(second.salt);
    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);

    // Both still open: the randomness is in the blob, not in the passphrase.
    await expect(decryptPrivateKey(second, PASSPHRASE)).resolves.toBe(TEST_PRIVATE_KEY);
  });

  it('refuses a passphrase shorter than the minimum, before deriving anything', async () => {
    const short = 'a'.repeat(MINIMUM_PASSPHRASE_LENGTH - 1);

    await expect(encryptPrivateKey(TEST_PRIVATE_KEY, short)).rejects.toBeInstanceOf(
      WeakPassphraseError,
    );
  });

  it('refuses to encrypt something that is not a private key', async () => {
    await expect(encryptPrivateKey('no es una clave', PASSPHRASE)).rejects.toBeInstanceOf(
      InvalidPrivateKeyError,
    );
  });
});

describe('a wrong passphrase fails cleanly, and distinguishably', () => {
  it('throws KeystorePassphraseError, not a raw WebCrypto OperationError', async () => {
    const keystore = await encryptPrivateKey(TEST_PRIVATE_KEY, PASSPHRASE);

    const error = await decryptPrivateKey(keystore, OTHER_PASSPHRASE).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(KeystorePassphraseError);
    expect(error).not.toBeInstanceOf(KeystoreCorruptError);
    expect((error as Error).name).toBe('KeystorePassphraseError');
    // The raw failure would be an unreadable `OperationError` with no message.
    expect((error as Error).message.length).toBeGreaterThan(0);
  });

  it('never leaks the key it failed to open', async () => {
    const keystore = await encryptPrivateKey(TEST_PRIVATE_KEY, PASSPHRASE);
    const error = await decryptPrivateKey(keystore, OTHER_PASSPHRASE).catch(
      (caught: unknown) => caught,
    );

    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(
      TEST_PRIVATE_KEY.slice(2),
    );
  });
});

describe('a corrupt or unknown blob fails with its own error', () => {
  it('refuses text that is not JSON at all', () => {
    expect(() => parseKeystore('no es json')).toThrow(KeystoreCorruptError);
  });

  it('refuses a JSON object with fields missing', () => {
    expect(() => parseKeystore(JSON.stringify({ version: KEYSTORE_VERSION }))).toThrow(
      KeystoreCorruptError,
    );
  });

  it('refuses a version it does not know how to read', async () => {
    const keystore = await encryptPrivateKey(TEST_PRIVATE_KEY, PASSPHRASE);
    const future = JSON.stringify({ ...keystore, version: KEYSTORE_VERSION + 1 });

    expect(() => parseKeystore(future)).toThrow(KeystoreCorruptError);
  });

  it('refuses a blob that claims fewer iterations than the floor', async () => {
    const keystore = await encryptPrivateKey(TEST_PRIVATE_KEY, PASSPHRASE);
    const weakened = { ...keystore, iterations: 1000 };

    await expect(decryptPrivateKey(weakened, PASSPHRASE)).rejects.toBeInstanceOf(
      KeystoreCorruptError,
    );
  });

  it('reports a truncated ciphertext as corrupt rather than as a wrong passphrase', async () => {
    const keystore = await encryptPrivateKey(TEST_PRIVATE_KEY, PASSPHRASE);
    const truncated = { ...keystore, iv: globalThis.btoa('short') };

    await expect(decryptPrivateKey(truncated, PASSPHRASE)).rejects.toBeInstanceOf(
      KeystoreCorruptError,
    );
  });
});

describe('what reaches the browser store', () => {
  it('round-trips through localStorage under a project-prefixed key', async () => {
    const keystore = await encryptPrivateKey(TEST_PRIVATE_KEY, PASSPHRASE);
    saveKeystore(keystore);

    expect(KEYSTORE_STORAGE_KEY.startsWith('recetas.')).toBe(true);
    expect(globalThis.localStorage.getItem(KEYSTORE_STORAGE_KEY)).not.toBeNull();
    expect(loadKeystore()).toEqual(keystore);
    await expect(decryptPrivateKey(loadKeystore() as never, PASSPHRASE)).resolves.toBe(
      TEST_PRIVATE_KEY,
    );
  });

  // The rule this whole file exists to keep (docs/23): the key in the clear
  // must not be reachable from the browser store, in any encoding.
  it('never writes the private key in the clear, in hex or in base64', async () => {
    const keystore = await encryptPrivateKey(TEST_PRIVATE_KEY, PASSPHRASE);
    saveKeystore(keystore);

    const written = globalThis.localStorage.getItem(KEYSTORE_STORAGE_KEY) ?? '';
    const raw = TEST_PRIVATE_KEY.slice(2);

    expect(written).not.toContain(raw);
    expect(written).not.toContain(raw.toUpperCase());
    expect(written).not.toContain(PASSPHRASE);
    expect(serialiseKeystore(keystore)).not.toContain(raw);
  });

  it('says whether a device has a key, and forgets it on request', async () => {
    expect(hasKeystore()).toBe(false);

    saveKeystore(await encryptPrivateKey(TEST_PRIVATE_KEY, PASSPHRASE));
    expect(hasKeystore()).toBe(true);

    clearKeystore();
    expect(hasKeystore()).toBe(false);
    expect(loadKeystore()).toBeNull();
    expect(globalThis.localStorage.getItem(KEYSTORE_STORAGE_KEY)).toBeNull();
  });

  it('reports a damaged stored blob as corrupt, so the screen can offer to erase it', () => {
    globalThis.localStorage.setItem(KEYSTORE_STORAGE_KEY, '{ truncated');

    // `hasKeystore` stays true on purpose: something IS stored, and the only
    // way out is the erase action, which needs the screen to know it is there.
    expect(hasKeystore()).toBe(true);
    expect(() => loadKeystore()).toThrow(KeystoreCorruptError);
  });
});
