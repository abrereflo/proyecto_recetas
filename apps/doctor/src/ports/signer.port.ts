import type { PrescriptionMessage } from '@recetas/chain';
import type { Address, Hex } from '@recetas/shared';

/**
 * The prescriber's own signing account: identity, network, and the EIP-712
 * signature of screen D5.
 *
 * HARD RULE (docs/01, docs/17): nothing in this layer may surface the words
 * "wallet", "frase semilla" or "saldo" to the interface. The RPC method names
 * used by the adapter are protocol identifiers in code, never screen copy.
 *
 * Signing lives in this port rather than in a shared helper because the
 * mechanism is what differs between consumers: apps/cli holds a raw private key
 * and signs through a `LocalAccount`, and this app signs through an EIP-1193
 * provider whose key it never sees. The message itself — field order, domain and
 * MVP nonce — is shared and comes from @recetas/chain.
 *
 * TODO (docs/01, D-04, Fase 5): the pilot replaces this with an ERC-4337 smart
 * account backed by a passkey, so the prescriber never handles a key at all
 * (screen D1). The port boundary is what makes that swap a one-file change.
 */

export interface SignPrescriptionInput {
  /** The account that must produce the signature. */
  prescriber: Address;
  /**
   * The typed data, already completed with `MVP_NONCE` by `buildMessage`.
   *
   * HARD RULE (docs/03): this message carries no patient identifier and no
   * salt, only the salted commitment. The type is the enforcement.
   */
  message: PrescriptionMessage;
}

export interface SignerPort {
  /** False when the browser exposes no injected provider at all. */
  isAvailable(): boolean;

  /** The already-authorised account, without prompting. */
  getAccount(): Promise<Address | null>;

  /** Prompts for authorisation and returns the account. */
  connect(): Promise<Address>;

  getChainId(): Promise<number>;

  /** Asks the provider to move to `chainId`; resolves once it is there. */
  ensureChain(chainId: number): Promise<void>;

  /**
   * Signs the prescription message (screen D5).
   *
   * Rejects with `SignerRejectedError` when the prescriber declines. Declining
   * is a decision, not a failure, and the issuing use case reports it as such.
   */
  signPrescription(input: SignPrescriptionInput): Promise<Hex>;
}

/** No injected provider: this device cannot sign a prescription. */
export class SignerUnavailableError extends Error {
  constructor() {
    super('Este dispositivo no tiene configurada una cuenta médica para firmar.');
    this.name = 'SignerUnavailableError';
  }
}

/** The person declined the prompt. Not an error state, a decision. */
export class SignerRejectedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('La firma fue cancelada desde el dispositivo.', options);
    this.name = 'SignerRejectedError';
  }
}
