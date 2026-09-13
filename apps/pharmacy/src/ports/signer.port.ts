import type { Address, Bytes32, Hex } from '@recetas/shared';

/**
 * The pharmacy's own signing account, and verification of the prescriber's
 * signature. Two different duties, one file, because both are "who signed what".
 *
 * HARD RULE (docs/01, docs/17): nothing in this layer may surface the words
 * "wallet", "frase semilla" or "saldo" to the interface. The RPC method names
 * below are protocol identifiers in code, never screen copy.
 */

/**
 * Corte 2 (docs/21-acceso-para-la-demo.md): the shape of the EIP-1193
 * provider itself. It belongs to the port, not to the adapter that
 * implements it, because `infrastructure/chain` needs the name of this type
 * without importing anything from `infrastructure/signer` — that import is
 * exactly the dependency this corte removes. It stays a plain JSON-RPC
 * request shape, never a viem type, so the port keeps expressing intent
 * ("give me the provider") instead of leaking a library detail.
 */
export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

/** Identity and network of the account that will register the dispensation. */
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
   * The raw provider, for the one thing that still needs it directly: the
   * chain adapter's write call, which builds its own `walletClient` (Corte 2
   * of docs/21-acceso-para-la-demo.md). `undefined` when none is available,
   * exactly like `isAvailable()`/`getAccount()` above.
   */
  getProvider(): Eip1193Provider | undefined;
}

/**
 * The EIP-712 message the prescriber signed at issue time.
 *
 * Field order and types live in `PRESCRIPTION_EIP712_TYPES` (@recetas/shared);
 * this is only the data side. HARD RULE (docs/03): no patient identifier
 * appears here, only the salted commitment.
 */
export interface PrescriberSignatureInput {
  prescriber: Address;
  contentHash: Bytes32;
  patientCommitment: Bytes32;
  /** Unix seconds, taken from the decrypted document. */
  issuedAt: bigint;
  /** Unix seconds, taken from the on-chain record. */
  expiresAt: bigint;
  signature: Hex;
}

export interface PrescriberSignatureVerifier {
  verify(input: PrescriberSignatureInput): Promise<boolean>;
}

/** No injected provider: the device cannot register a dispensation. */
export class SignerUnavailableError extends Error {
  constructor() {
    super('Este dispositivo no tiene configurada una cuenta de farmacia para firmar.');
    this.name = 'SignerUnavailableError';
  }
}

/** The person declined the prompt. Not an error state, a decision. */
export class SignerRejectedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('La operación fue cancelada desde el dispositivo.', options);
    this.name = 'SignerRejectedError';
  }
}
