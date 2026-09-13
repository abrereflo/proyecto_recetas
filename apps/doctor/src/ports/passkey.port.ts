import type { Bytes32, Hex } from '@recetas/shared';

/**
 * The prescriber's passkey: enrolling one, and authorising an operation with
 * it.
 *
 * WHY THIS IS A SECOND PORT AND NOT AN ADAPTER FOR `SignerPort`. The two were
 * weighed and they are not the same boundary.
 *
 *   - THEY PRODUCE DIFFERENT ARTEFACTS. `SignerPort.signPrescription` returns
 *     an EIP-712 signature over the prescription message, which the pharmacy
 *     verifies OFF chain (docs/01). This port returns an ABI-encoded
 *     `WebAuthn.Assertion` over a `userOpHash`, which an ERC-4337 EntryPoint
 *     verifies ON chain through `PasskeyAccount`. One is a message signature,
 *     the other is an operation authorisation; they have different inputs,
 *     different verifiers and different lifetimes.
 *   - HALF OF `SignerPort` WOULD HAVE TO LIE. That interface also carries
 *     `getChainId`, `ensureChain` and `getProvider`, because it wraps an
 *     injected EIP-1193 provider — and `infrastructure/chain` consumes
 *     `getProvider()` for the write path (Corte 2 of docs/21). A passkey has no
 *     provider, no accounts and no chain to switch to. Implementing those as
 *     stubs would put four methods in the contract that no caller may use, and
 *     `no-signer-import.test.ts` exists precisely because this codebase has
 *     already paid once for a dependency that crossed a boundary it should not
 *     have.
 *   - THEY COEXIST BEFORE EITHER REPLACES THE OTHER. D-04 says the pilot
 *     replaces the injected account with a smart account. Until the relayer of
 *     Fase 5 item 5 exists there is nothing to submit a UserOperation to, so
 *     both mechanisms are present at once. Two ports say that honestly; one
 *     port with a mode flag would not.
 *
 * HARD RULE (docs/01, docs/17): nothing in this layer may surface the words
 * «wallet», seed phrase or balance to the interface. WebAuthn's own vocabulary
 * — credential, authenticator, assertion — stays in code and never reaches a
 * screen; what the doctor sees is a fingerprint, a face or a device PIN.
 */

/**
 * What an enrolment produces: the owner of a `PasskeyAccount`.
 *
 * These two coordinates are constructor arguments of that account, and the
 * account address is a CREATE2 commitment to them, so this value is permanent.
 * There is no rotation and no recovery: a lost passkey is a new enrolment, a
 * new address and a fresh EAS credential (see `PasskeyAccount`'s header).
 */
export interface PasskeyCredential {
  /** `rawId`, base64url. Names the credential at every later ceremony. */
  credentialId: string;
  /** Owner's public key, X. 32 bytes, `0x`-prefixed. */
  publicKeyX: Hex;
  /** Owner's public key, Y. */
  publicKeyY: Hex;
  /**
   * The authenticator says this credential may be synced to other devices.
   * Recorded, never enforced: `WebAuthn.check` only refuses the contradiction
   * of a backed-up credential that claims it cannot be backed up.
   */
  backupEligible: boolean;
}

export interface RegisterPasskeyInput {
  /** Stable, non-clinical handle for the prescriber. base64url. */
  userId: string;
  /** What the authenticator lists the credential under. */
  userName: string;
  userDisplayName: string;
  /** What the device prompt names. Never the word for a crypto product. */
  serviceName: string;
  /** Relying Party id. Defaults to the page's own domain. */
  rpId?: string;
  timeoutMs?: number;
}

export interface AuthorizePasskeyInput {
  /**
   * The EntryPoint's digest over the operation. It travels inside
   * `clientDataJSON` as a base64url `challenge`, which is what binds the
   * assertion to this operation, this chain and this account.
   */
  userOpHash: Bytes32;
  /** Restricts the ceremony to the enrolled credential. */
  credentialId?: string;
  rpId?: string;
  timeoutMs?: number;
}

export interface PasskeyAuthorization {
  /**
   * The ABI-encoded `WebAuthn.Assertion`, ready to travel as
   * `userOp.signature`.
   */
  signature: Hex;
  /** Which credential answered. Not always the one that was asked for. */
  credentialId: string;
}

/**
 * `WebAuthn.Rejection` (contracts/src/WebAuthn.sol), in declaration order, so
 * the index of a member IS its on-chain enum value.
 *
 * WHY IT LIVES IN THE PORT. It is the vocabulary in which a refusal is
 * explained, and two different implementations answer in it: the local
 * pre-flight that runs before anything is submitted, and
 * `PasskeyAccount.checkAssertion`, a free `eth_call` that reverts with exactly
 * this value. A vocabulary shared by both sides of a boundary belongs to the
 * boundary.
 */
export const ASSERTION_REJECTIONS = [
  'None',
  'MalformedEnvelope',
  'AuthenticatorDataTooShort',
  'UserNotPresent',
  'UserNotVerified',
  'InconsistentBackupFlags',
  'WrongCeremonyType',
  'ChallengeMismatch',
  'HighS',
  'InvalidSignature',
] as const;

export type AssertionRejection = (typeof ASSERTION_REJECTIONS)[number];

export interface PasskeyPort {
  /** False when the browser has no WebAuthn at all. */
  isAvailable(): boolean;

  /**
   * True when this device can verify the user itself — a fingerprint, a face
   * or a device PIN. A device that can only prove someone touched it cannot
   * hold a prescriber credential, because `WebAuthn.check` requires User
   * Verified and not merely User Present.
   */
  hasVerifyingAuthenticator(): Promise<boolean>;

  /** Enrols a new passkey and returns the key the account will commit to. */
  register(input: RegisterPasskeyInput): Promise<PasskeyCredential>;

  /**
   * Runs an authentication ceremony over `userOpHash` and returns the envelope
   * `PasskeyAccount` decodes.
   *
   * Rejects with `PasskeyRejectedError` when the prescriber declines or lets
   * the prompt time out — a decision, not a failure — and with
   * `PasskeyAssertionRefusedError` when the ceremony produced something the
   * account would refuse.
   */
  authorize(input: AuthorizePasskeyInput): Promise<PasskeyAuthorization>;
}

/** This device cannot hold a prescriber credential. */
export class PasskeyUnavailableError extends Error {
  constructor(message = 'Este dispositivo no puede confirmar la identidad de quien firma.') {
    super(message);
    this.name = 'PasskeyUnavailableError';
  }
}

/** The person declined the prompt, or let it expire. Not an error state. */
export class PasskeyRejectedError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('La autorización fue cancelada desde el dispositivo.', options);
    this.name = 'PasskeyRejectedError';
  }
}

/**
 * The ceremony completed and produced something the account would refuse.
 *
 * Carries the reason so a screen can say which of the nine it was, rather than
 * offering the doctor the single silent failure ERC-4337 would otherwise
 * leave them with.
 */
export class PasskeyAssertionRefusedError extends Error {
  constructor(
    readonly reason: AssertionRejection,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PasskeyAssertionRefusedError';
  }
}
