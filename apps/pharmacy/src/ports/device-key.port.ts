import type { Address } from '@recetas/shared';

/**
 * The device's own signing key, when there is no injected provider to borrow
 * one from (docs/23-firma-en-el-dispositivo.md).
 *
 * WHY THIS IS A SEPARATE PORT. `SignerPort` answers "who signs, and on which
 * chain"; this one answers "is the key on this device open, and how does it get
 * opened". Only ONE screen ever touches it — the one that asks for the
 * passphrase — and the eight screens of docs/17 never see it, exactly as the
 * composition root's header promises. When the ERC-4337 passkey account of
 * D-04 lands, this port and its screen are deleted whole; `SignerPort` is not.
 *
 * HARD RULE (docs/01, docs/17): no implementation and no screen behind this
 * port may say "wallet", "frase semilla" or "saldo". What the pharmacist has is
 * a clave de firma on a device, protected by a contraseña.
 */
export interface DeviceKeyPort {
  /** True when this browser holds an encrypted key, open or not. */
  hasKey(): boolean;

  /** True when the key has been decrypted into memory for this session. */
  isUnlocked(): boolean;

  /**
   * First use on a device: encrypts `privateKey` under `passphrase`, stores the
   * result and leaves the signer unlocked. Rejects with a named error when the
   * key is malformed or the passphrase is too short.
   */
  enrol(privateKey: string, passphrase: string): Promise<Address>;

  /** Opens the stored key. Rejects when the passphrase does not open it. */
  unlock(passphrase: string): Promise<Address>;

  /** Erases the decrypted key from memory. The stored blob is untouched. */
  lock(): void;

  /** Erases the stored blob from this device. Irreversible without the key. */
  forget(): void;
}
