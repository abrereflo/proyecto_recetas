import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  encodeFunctionData,
  type Address,
  type Hex,
} from 'viem';
import type { Bytes32 } from '@recetas/shared';
import { ASSERTION_REJECTIONS, type AssertionRejection } from '../../ports/passkey.port';
import { challengeFor, P256_ORDER_HALF, type WebAuthnAssertion } from './assertion-envelope';
import { AUTHENTICATOR_DATA_MIN_LENGTH, readFlags } from './authenticator-data';

/**
 * Why an assertion would be refused — answered twice, by two mechanisms that
 * check the same rules.
 *
 * WHY THIS MODULE EXISTS. ERC-4337 lets `validateUserOp` answer `0` or `1` and
 * nothing else, so every one of the nine ways an assertion can be wrong reaches
 * the consulting room as the same silent failure. `PasskeyAccount.checkAssertion`
 * is the contract's answer to that: a free `eth_call` that reverts with
 * `AssertionRejected(reason)`. `decodeAssertionRejection` below turns that
 * revert back into a reason, and `describeRejection` turns the reason into
 * something a doctor can act on.
 *
 * AND WHY THERE IS ALSO A LOCAL CHECK. `inspectAssertion` re-implements the
 * cheap half of `WebAuthn.check` in TypeScript. That is duplication and it is
 * bought on purpose:
 *
 *   - It answers with no network and no deployed account, which matters
 *     because the account is COUNTERFACTUAL until its first operation — there
 *     is no code at the address to `eth_call` before then, so for the very
 *     first prescription the on-chain diagnostic is not available at all.
 *   - It runs before the ceremony's result is handed to a bundler, so a
 *     malformed envelope never becomes a submitted operation.
 *   - Seven of the ten reasons need no elliptic-curve arithmetic and no chain
 *     state. `InvalidSignature` does; `MalformedEnvelope` is a decode failure
 *     that cannot happen to an envelope this client built. Those stay on chain.
 *
 * THE DUPLICATION IS THE RISK AND IT IS NAMED. Two implementations of one rule
 * can drift, and if they do it is this one that is wrong, because the contract
 * is what decides. `inspectAssertion` is therefore only ever a FASTER answer to
 * the same question, never an authority: nothing in this app may accept an
 * assertion because the local check liked it. The tests pin it against the same
 * published vectors the Solidity suite uses, in the same order of checks, so a
 * divergence shows up as a failing test rather than as an accepted forgery.
 */

/** `"type":"webauthn.get"` — 21 bytes, quotes and colon included. */
const TYPE_FIELD = '"type":"webauthn.get"';

/** `"challenge":"` + 43 base64url characters + `"`. */
const CHALLENGE_FIELD_LENGTH = 57;

const encoder = new TextEncoder();

/**
 * The fragment of `PasskeyAccount` this app calls and decodes.
 *
 * Deliberately not the whole ABI. Nothing here issues a prescription through
 * the account — that needs the bundler of Fase 5 item 5 — so carrying
 * `validateUserOp` or `execute` would be carrying a promise this app does not
 * keep.
 */
export const passkeyAccountAssertionAbi = [
  {
    type: 'function',
    name: 'checkAssertion',
    stateMutability: 'view',
    inputs: [
      { name: 'signature', type: 'bytes' },
      { name: 'userOpHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'error',
    name: 'AssertionRejected',
    inputs: [{ name: 'reason', type: 'uint8' }],
  },
] as const;

/** An `eth_call` that asks the account why, and costs nothing. */
export function checkAssertionCall(input: {
  account: Address;
  signature: Hex;
  userOpHash: Bytes32;
}): { to: Address; data: Hex } {
  return {
    to: input.account,
    data: encodeFunctionData({
      abi: passkeyAccountAssertionAbi,
      functionName: 'checkAssertion',
      args: [input.signature, input.userOpHash],
    }),
  };
}

function rawRevertData(error: unknown): Hex | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  const candidate = (error as { data?: unknown }).data;
  if (typeof candidate === 'string' && candidate.startsWith('0x') && candidate.length >= 10) {
    return candidate as Hex;
  }

  const cause = (error as { cause?: unknown }).cause;
  return cause === undefined ? undefined : rawRevertData(cause);
}

function rejectionFrom(args: readonly unknown[] | undefined): AssertionRejection | undefined {
  const reason = args?.[0];
  if (typeof reason !== 'number' && typeof reason !== 'bigint') return undefined;

  return ASSERTION_REJECTIONS[Number(reason)];
}

/**
 * The reason inside an `AssertionRejected` revert, or `undefined` for anything
 * that is not one.
 *
 * Follows the pipeline `packages/chain/src/registry-errors.ts` already
 * established for the registry's custom errors: the `ContractFunctionRevertedError`
 * viem raises from a simulated call first, then a bare revert blob found down
 * the `cause` chain, which is what some nodes return instead.
 */
export function decodeAssertionRejection(error: unknown): AssertionRejection | undefined {
  if (error instanceof BaseError) {
    const reverted = error.walk((candidate) => candidate instanceof ContractFunctionRevertedError);

    if (
      reverted instanceof ContractFunctionRevertedError &&
      reverted.data?.errorName === 'AssertionRejected'
    ) {
      return rejectionFrom(reverted.data.args as readonly unknown[] | undefined);
    }
  }

  const raw = rawRevertData(error);
  if (raw === undefined) return undefined;

  try {
    const decoded = decodeErrorResult({ abi: passkeyAccountAssertionAbi, data: raw });
    if (decoded.errorName !== 'AssertionRejected') return undefined;
    return rejectionFrom(decoded.args as readonly unknown[] | undefined);
  } catch {
    return undefined;
  }
}

/**
 * Does the window of `data` at `offset` equal `expected`?
 *
 * Compared as BYTES, and bounds-checked the way `WebAuthn._matchesAt` is — as
 * subtractions from the length, so an offset a malformed ceremony put past the
 * end is a `false` and never an exception. Decoding the window to a string
 * first would be wrong twice over: invalid UTF-8 would become U+FFFD and
 * compare equal to nothing in particular, and the offsets are byte offsets.
 */
function matchesAt(data: Uint8Array, offset: number, expected: Uint8Array): boolean {
  if (expected.length > data.length) return false;
  if (offset > data.length - expected.length) return false;

  for (let i = 0; i < expected.length; i += 1) {
    if (data[offset + i] !== expected[i]!) return false;
  }

  return true;
}

/**
 * The cheap half of `WebAuthn.check`, in the same order, without a network.
 *
 * Returns `'None'` when nothing LOCALLY DETECTABLE is wrong. That is not the
 * same as valid: the P-256 verification and the public key both live on chain.
 */
export function inspectAssertion(
  assertion: WebAuthnAssertion,
  userOpHash: Bytes32,
): AssertionRejection {
  // Malleability first, exactly as the contract does it, because it is one
  // comparison and because it is the mistake this design makes likeliest.
  if (assertion.s > P256_ORDER_HALF) return 'HighS';

  if (assertion.authenticatorData.length < AUTHENTICATOR_DATA_MIN_LENGTH) {
    return 'AuthenticatorDataTooShort';
  }

  const flags = readFlags(assertion.authenticatorData[32]!);

  if (!flags.userPresent) return 'UserNotPresent';

  // Mandatory here, as on chain. A prescription has to name the person who
  // signed it, not the device that was tapped.
  if (!flags.userVerified) return 'UserNotVerified';

  if (!flags.backupEligible && flags.backupState) return 'InconsistentBackupFlags';

  if (!matchesAt(assertion.clientDataJSON, assertion.typeIndex, encoder.encode(TYPE_FIELD))) {
    return 'WrongCeremonyType';
  }

  const expectedChallenge = encoder.encode(`"challenge":"${challengeFor(userOpHash)}"`);

  // 13 + 43 + 1. Pinned rather than derived, because a challenge that did not
  // encode to 43 characters would silently shorten the anchored window and
  // weaken the very comparison this mirrors.
  if (expectedChallenge.length !== CHALLENGE_FIELD_LENGTH) {
    return 'ChallengeMismatch';
  }

  if (!matchesAt(assertion.clientDataJSON, assertion.challengeIndex, expectedChallenge)) {
    return 'ChallengeMismatch';
  }

  return 'None';
}

/**
 * What the consulting room is told.
 *
 * HARD RULE (docs/01, docs/17): no «wallet», no seed phrase, no balance. These
 * messages describe a fingerprint, a face or a device PIN, because that is what
 * the doctor actually did, and they never mention a key, a signature scheme or
 * a chain. Two of the reasons — `HighS` and `MalformedEnvelope` — can only be
 * caused by a bug in this client, so their text says "the system" rather than
 * blaming the device the doctor is holding.
 */
export function describeRejection(reason: AssertionRejection): string {
  switch (reason) {
    case 'None':
      return 'La autorización es válida.';

    case 'MalformedEnvelope':
      return 'La autorización no llegó completa al sistema. Vuelva a intentarlo; si se repite, avise a soporte.';

    case 'AuthenticatorDataTooShort':
      return 'El dispositivo devolvió una respuesta incompleta. Vuelva a intentarlo.';

    case 'UserNotPresent':
      return 'No hubo confirmación en el dispositivo. Repita la autorización y confirme cuando se lo pida.';

    case 'UserNotVerified':
      return (
        'El dispositivo no comprobó quién está autorizando. Active la huella, el reconocimiento facial ' +
        'o el PIN del dispositivo y repita la autorización.'
      );

    case 'InconsistentBackupFlags':
      return 'El dispositivo informó un estado contradictorio sobre su credencial. Vuelva a intentarlo desde este mismo dispositivo.';

    case 'WrongCeremonyType':
      return 'Lo que se autorizó fue el alta de la credencial, no esta receta. Repita la autorización desde la pantalla de la receta.';

    case 'ChallengeMismatch':
      return 'La autorización corresponde a otra receta. Vuelva a la receta que está en pantalla y autorícela de nuevo.';

    case 'HighS':
      return 'El sistema preparó la autorización en un formato que la red no acepta. Vuelva a intentarlo; si se repite, avise a soporte.';

    case 'InvalidSignature':
      return 'La credencial que autorizó no es la registrada para este profesional. Use el dispositivo con el que se dio de alta.';
  }
}
