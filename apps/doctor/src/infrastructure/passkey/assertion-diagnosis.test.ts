import { describe, expect, it } from 'vitest';
import {
  BaseError,
  ContractFunctionRevertedError,
  decodeFunctionData,
  encodeErrorResult,
  type Address,
  type Hex,
} from 'viem';
import type { Bytes32 } from '@recetas/shared';
import { ASSERTION_REJECTIONS, type AssertionRejection } from '../../ports/passkey.port';
import {
  checkAssertionCall,
  decodeAssertionRejection,
  describeRejection,
  inspectAssertion,
  passkeyAccountAssertionAbi,
} from './assertion-diagnosis';
import {
  assertionFromResponse,
  challengeFor,
  encodeAssertion,
  P256_ORDER_HALF,
  type WebAuthnAssertion,
} from './assertion-envelope';
import { P256_ORDER } from './der';
import {
  CHROME_ASSERTION,
  SAFARI_ASSERTION,
  VECTOR_CHALLENGE,
  VECTOR_CHALLENGE_B64URL,
} from '../../test/webauthn-vectors';

/**
 * The two halves of "why was this refused": the local pre-flight, and the
 * decoding of what `PasskeyAccount.checkAssertion` reverts with.
 *
 * The pre-flight is asserted against the SAME published vectors
 * `contracts/test/WebAuthn.t.sol` feeds `WebAuthn.check`, in the same order of
 * checks. That is what keeps the duplication honest: if this implementation
 * ever drifts from the contract's, these tests are where it shows.
 */

const ACCOUNT = '0x5555555555555555555555555555555555555555' as Address;

const OTHER_CHALLENGE = `0x${'ab'.repeat(32)}` as Bytes32;

function safari(): WebAuthnAssertion {
  return assertionFromResponse(SAFARI_ASSERTION);
}

function withAuthenticatorFlags(flags: number): WebAuthnAssertion {
  const assertion = safari();
  const authenticatorData = Uint8Array.from(assertion.authenticatorData);
  authenticatorData[32] = flags;
  return { ...assertion, authenticatorData };
}

describe('inspectAssertion accepts what the contract accepts', () => {
  it('passes a real Safari assertion against the challenge it authorises', () => {
    expect(inspectAssertion(safari(), VECTOR_CHALLENGE)).toBe('None');
  });

  it('passes a real Chrome assertion, whose document is longer', () => {
    expect(inspectAssertion(assertionFromResponse(CHROME_ASSERTION), VECTOR_CHALLENGE)).toBe('None');
  });
});

describe('inspectAssertion refuses what the contract refuses, and says which', () => {
  it('HighS, before anything else, because it is the likeliest client bug', () => {
    // A high `s` on an otherwise perfect assertion, which is what half of all
    // real authenticator output looks like before `normaliseS` runs.
    const assertion = { ...safari(), s: P256_ORDER - SAFARI_ASSERTION.s };

    expect(assertion.s).toBeGreaterThan(P256_ORDER_HALF);
    expect(inspectAssertion(assertion, VECTOR_CHALLENGE)).toBe('HighS');
  });

  it('AuthenticatorDataTooShort for fewer than 37 bytes', () => {
    const assertion = { ...safari(), authenticatorData: new Uint8Array(36) };

    expect(inspectAssertion(assertion, VECTOR_CHALLENGE)).toBe('AuthenticatorDataTooShort');
  });

  it('UserNotPresent when nobody touched the device', () => {
    expect(inspectAssertion(withAuthenticatorFlags(0x04), VECTOR_CHALLENGE)).toBe('UserNotPresent');
  });

  it('UserNotVerified when the device only proved someone touched it', () => {
    expect(inspectAssertion(withAuthenticatorFlags(0x01), VECTOR_CHALLENGE)).toBe('UserNotVerified');
  });

  it('InconsistentBackupFlags for a credential backed up and not eligible to be', () => {
    expect(inspectAssertion(withAuthenticatorFlags(0x15), VECTOR_CHALLENGE)).toBe(
      'InconsistentBackupFlags',
    );
  });

  it('WrongCeremonyType when typeIndex points somewhere that is not webauthn.get', () => {
    const assertion = { ...safari(), typeIndex: 2 };

    expect(inspectAssertion(assertion, VECTOR_CHALLENGE)).toBe('WrongCeremonyType');
  });

  it('ChallengeMismatch for a genuine assertion over another operation', () => {
    expect(inspectAssertion(safari(), OTHER_CHALLENGE)).toBe('ChallengeMismatch');
  });

  it('ChallengeMismatch, not an exception, for an index past the end of the document', () => {
    const assertion = { ...safari(), challengeIndex: 100_000 };

    expect(inspectAssertion(assertion, VECTOR_CHALLENGE)).toBe('ChallengeMismatch');
  });

  it('refuses the smuggled-challenge attack the anchored comparison exists to stop', () => {
    // A genuine assertion whose `origin` carries the victim's operation. A
    // naive substring search would find it and say yes; the anchored
    // comparison at `challengeIndex` cannot, because JSON has no way to put an
    // unescaped quote inside a string value.
    const attackersOwnOperation = VECTOR_CHALLENGE_B64URL;
    const victimsOperation = challengeFor(OTHER_CHALLENGE);

    const document = new TextEncoder().encode(
      `{"type":"webauthn.get","challenge":"${attackersOwnOperation}",` +
        `"origin":"https://evil.example/?x=${victimsOperation}"}`,
    );

    const assertion = { ...safari(), clientDataJSON: document };

    // The naive search finds the victim's challenge...
    expect(new TextDecoder().decode(document)).toContain(victimsOperation);
    // ...and the anchored one still refuses it.
    expect(inspectAssertion(assertion, OTHER_CHALLENGE)).toBe('ChallengeMismatch');
  });

  it('checks in the same order the contract does: HighS wins over a bad flag', () => {
    const assertion = { ...withAuthenticatorFlags(0x01), s: P256_ORDER - SAFARI_ASSERTION.s };

    expect(inspectAssertion(assertion, VECTOR_CHALLENGE)).toBe('HighS');
  });
});

describe('checkAssertionCall', () => {
  it('encodes the free eth_call the account answers with a reason', () => {
    const signature = encodeAssertion(safari());
    const call = checkAssertionCall({ account: ACCOUNT, signature, userOpHash: VECTOR_CHALLENGE });

    expect(call.to).toBe(ACCOUNT);

    const decoded = decodeFunctionData({ abi: passkeyAccountAssertionAbi, data: call.data });

    expect(decoded.functionName).toBe('checkAssertion');
    expect(decoded.args).toEqual([signature, VECTOR_CHALLENGE]);
  });
});

describe('decodeAssertionRejection', () => {
  const revertWith = (reason: number): { data: Hex } => ({
    data: encodeErrorResult({
      abi: passkeyAccountAssertionAbi,
      errorName: 'AssertionRejected',
      args: [reason],
    }),
  });

  it.each(ASSERTION_REJECTIONS.map((name, index) => [name, index] as const))(
    'reads %s out of a bare revert blob',
    (name, index) => {
      expect(decodeAssertionRejection(revertWith(index))).toBe(name);
    },
  );

  it('finds the blob down a cause chain, which is where a transport wraps it', () => {
    expect(decodeAssertionRejection({ cause: { cause: revertWith(8) } })).toBe('HighS');
  });

  it('reads the rich error viem raises from a simulated call', () => {
    const reverted = new ContractFunctionRevertedError({
      abi: passkeyAccountAssertionAbi as never,
      data: revertWith(4).data,
      functionName: 'checkAssertion',
    });

    expect(decodeAssertionRejection(new BaseError('reverted', { cause: reverted }))).toBe(
      'UserNotVerified',
    );
  });

  it('returns undefined for a revert that is not this error', () => {
    expect(decodeAssertionRejection({ data: '0xdeadbeef' as Hex })).toBeUndefined();
  });

  it('returns undefined for something that is not a revert at all', () => {
    expect(decodeAssertionRejection(new Error('network down'))).toBeUndefined();
    expect(decodeAssertionRejection(undefined)).toBeUndefined();
  });

  it('returns undefined for an enum value this client has never heard of', () => {
    expect(decodeAssertionRejection(revertWith(200))).toBeUndefined();
  });
});

describe('describeRejection speaks to a consulting room', () => {
  const FORBIDDEN = ['wallet', 'frase semilla', 'saldo'];

  it.each(ASSERTION_REJECTIONS)('has something to say about %s', (reason) => {
    const message = describeRejection(reason);

    expect(message.length).toBeGreaterThan(20);
    for (const word of FORBIDDEN) expect(message.toLowerCase()).not.toContain(word);
  });

  it('never repeats itself, so the nine failures stay distinguishable', () => {
    const messages = ASSERTION_REJECTIONS.map((reason: AssertionRejection) =>
      describeRejection(reason),
    );

    expect(new Set(messages).size).toBe(messages.length);
  });

  it('tells the doctor what to do about the one they can fix', () => {
    expect(describeRejection('UserNotVerified')).toMatch(/huella|facial|PIN/);
  });

  it('blames the system, not the device, for the one only this client can cause', () => {
    expect(describeRejection('HighS')).toMatch(/sistema/i);
  });
});

describe('the vocabulary is the contract’s', () => {
  it('lists the ten rejections in the order WebAuthn.Rejection declares them', () => {
    // Read off contracts/src/WebAuthn.sol. The index is the enum value, so a
    // reordering here would silently map every diagnosis to the wrong reason.
    expect([...ASSERTION_REJECTIONS]).toEqual([
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
    ]);
  });
});
