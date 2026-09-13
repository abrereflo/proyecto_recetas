import { describe, expect, it } from 'vitest';
import { decodeAbiParameters, size } from 'viem';
import { PLACEHOLDER_ASSERTION_SIGNATURE } from '@recetas/chain';
import { base64UrlToBytes } from '@recetas/crypto';
import { assertionFromResponse, buildAssertion, encodeAssertion } from './assertion-envelope';
import { inspectAssertion } from './assertion-diagnosis';
import {
  CHROME_ASSERTION,
  CHROME_ASSERTION_HIGH_S_SIGNATURE,
  SAFARI_ASSERTION,
  VECTOR_CHALLENGE,
  type PublishedAssertion,
} from '../../test/webauthn-vectors';

/**
 * THE ONE TEST THAT PROVES THE TWO HALVES AGREE.
 *
 * Everything else in this suite checks that the client is internally
 * consistent. This file checks that the bytes it produces are the bytes
 * `contracts/test/WebAuthn.t.sol` hands `WebAuthn.check` — for two assertions
 * that neither half of this project created, made by real secure enclaves in
 * Safari and Chrome and published by Coinbase.
 *
 * HOW THE EXPECTED VALUE IS ARRIVED AT, because a golden test is only worth
 * what its golden is. Three independent statements have to hold at once:
 *
 *   1. The six FIELDS this client extracts equal, one for one, the literals the
 *      Solidity fixture assigns — `r`, `s`, `challengeIndex` and `typeIndex`
 *      included. Those literals came from Coinbase.
 *   2. The ABI ENCODING of those fields equals a blob produced here by a
 *      hand-written encoder that shares no code with the production one, laid
 *      out straight from the ABI specification: an offset word, a six-word
 *      head, and two length-prefixed tails padded to 32 bytes.
 *   3. The blob DECODES, with `clientDataJSON` typed as Solidity's `string`
 *      rather than as the `bytes` the encoder declared, back into the same
 *      values — which is what `abi.decode(signature, (WebAuthn.Assertion))`
 *      does on chain.
 *
 * WHAT IS STILL NOT PROVEN HERE: that `WebAuthn.check` accepts the blob. That
 * needs `forge`, and it is asserted on the Solidity side against these same
 * bytes. What this file removes is the possibility of the two sides disagreeing
 * about the ENCODING while both being right about everything else.
 */

/** Left-padded 32-byte word, written out rather than borrowed from viem. */
const word = (value: bigint): string => value.toString(16).padStart(64, '0');

/** Right-padded to a whole number of 32-byte words, as the ABI requires. */
const padTail = (hex: string): string => hex + '0'.repeat((64 - (hex.length % 64)) % 64);

const toHex = (bytes: Uint8Array): string =>
  [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

/**
 * `abi.encode(assertion)` for the struct in `contracts/src/WebAuthn.sol`, built
 * by hand from the specification.
 *
 * Shares nothing with `encodeAssertion`: no viem, no shared helper. If both
 * agree, they agree because the layout is right and not because they call the
 * same function.
 */
function independentlyEncode(vector: PublishedAssertion): string {
  const authenticatorData = toHex(base64UrlToBytes(vector.authenticatorData));
  const clientDataJSON = toHex(new TextEncoder().encode(vector.clientDataJSONText));

  const headLength = 6 * 32;
  const authenticatorDataTail = padTail(authenticatorData);
  const clientDataOffset = headLength + 32 + authenticatorDataTail.length / 2;

  const tuple =
    word(BigInt(headLength)) +
    word(BigInt(clientDataOffset)) +
    word(BigInt(vector.challengeIndex)) +
    word(BigInt(vector.typeIndex)) +
    word(vector.r) +
    word(vector.s) +
    word(BigInt(authenticatorData.length / 2)) +
    authenticatorDataTail +
    word(BigInt(clientDataJSON.length / 2)) +
    padTail(clientDataJSON);

  // A single dynamic argument: the head is one offset word pointing at the
  // tuple that follows it.
  return `0x${word(32n)}${tuple}`;
}

/** The struct as Solidity declares it, `string` and all. */
const SOLIDITY_ASSERTION = [
  {
    type: 'tuple',
    components: [
      { name: 'authenticatorData', type: 'bytes' },
      { name: 'clientDataJSON', type: 'string' },
      { name: 'challengeIndex', type: 'uint256' },
      { name: 'typeIndex', type: 'uint256' },
      { name: 'r', type: 'uint256' },
      { name: 's', type: 'uint256' },
    ],
  },
] as const;

describe.each([
  ['Safari, iCloud Keychain', SAFARI_ASSERTION],
  ['Chrome', CHROME_ASSERTION],
])('a real %s assertion', (_browser, vector) => {
  const assertion = assertionFromResponse(vector);

  it('extracts the same six fields the Solidity fixture assigns', () => {
    expect({
      authenticatorData: toHex(assertion.authenticatorData),
      clientDataJSON: new TextDecoder().decode(assertion.clientDataJSON),
      challengeIndex: assertion.challengeIndex,
      typeIndex: assertion.typeIndex,
      r: assertion.r,
      s: assertion.s,
    }).toEqual({
      authenticatorData: toHex(base64UrlToBytes(vector.authenticatorData)),
      clientDataJSON: vector.clientDataJSONText,
      challengeIndex: vector.challengeIndex,
      typeIndex: vector.typeIndex,
      r: vector.r,
      s: vector.s,
    });
  });

  it('encodes to the frozen envelope, byte for byte', () => {
    expect(encodeAssertion(assertion)).toBe(vector.envelope);
  });

  it('agrees with an encoder written from the ABI specification alone', () => {
    expect(encodeAssertion(assertion)).toBe(independentlyEncode(vector));
  });

  it('decodes back as the Solidity struct, with clientDataJSON as a string', () => {
    const [decoded] = decodeAbiParameters(SOLIDITY_ASSERTION, vector.envelope);

    expect(decoded.clientDataJSON).toBe(vector.clientDataJSONText);
    expect(decoded.challengeIndex).toBe(BigInt(vector.challengeIndex));
    expect(decoded.typeIndex).toBe(BigInt(vector.typeIndex));
    expect(decoded.r).toBe(vector.r);
    expect(decoded.s).toBe(vector.s);
  });

  it('would not be refused by the checks the contract runs before the curve', () => {
    expect(inspectAssertion(assertion, VECTOR_CHALLENGE)).toBe('None');
  });
});

describe('the envelope is the size WebAuthn.sol measured its gas against', () => {
  it('is 512 bytes for the Chrome document', () => {
    // "a 136-byte clientDataJSON and a 512-byte envelope" — the header of
    // contracts/src/WebAuthn.sol. A different figure here means the layout
    // moved.
    expect((CHROME_ASSERTION.envelope.length - 2) / 2).toBe(512);
  });

  it('is 480 bytes for the shorter Safari document', () => {
    expect((SAFARI_ASSERTION.envelope.length - 2) / 2).toBe(480);
  });
});

describe('the s flip, against a real signature rather than a constructed one', () => {
  it('turns the high twin of the Chrome signature into the published envelope', () => {
    // Both Coinbase vectors are already normalised, so neither can prove the
    // flip on its own. This is the same signature with `s` put back where an
    // enclave would have left it half the time: a 71-byte DER instead of 70,
    // because the high half needs a leading zero.
    const highS = base64UrlToBytes(CHROME_ASSERTION_HIGH_S_SIGNATURE);

    expect(highS.length).toBe(71);
    expect(base64UrlToBytes(CHROME_ASSERTION.signature).length).toBe(70);

    const assertion = buildAssertion({
      authenticatorData: base64UrlToBytes(CHROME_ASSERTION.authenticatorData),
      clientDataJSON: base64UrlToBytes(CHROME_ASSERTION.clientDataJSON),
      signature: highS,
    });

    // Byte-identical to the envelope built from the low-s signature, which is
    // the envelope the Solidity suite accepts.
    expect(encodeAssertion(assertion)).toBe(CHROME_ASSERTION.envelope);
  });
});

/**
 * THE RELAYER'S GAS ESTIMATE IS MADE BEFORE THIS ENVELOPE EXISTS.
 *
 * `preVerificationGas` has to cover the calldata the operation will carry, and
 * the operation's calldata is dominated by the WebAuthn envelope in
 * `userOp.signature`. At the moment the relayer sizes gas, the doctor has not
 * touched the sensor yet, so `@recetas/chain` estimates against
 * `PLACEHOLDER_ASSERTION_SIGNATURE` instead.
 *
 * That placeholder is only sound while it is AT LEAST AS EXPENSIVE as the real
 * thing. This test is the guard, and it lives here rather than in
 * `@recetas/chain` because this is the only package that holds envelopes made
 * by real secure enclaves — the two Coinbase vectors, from Safari and Chrome.
 *
 * If it ever fails, the fix is to grow the placeholder, never to relax the
 * assertion: an under-sized estimate does not produce a warning, it produces an
 * operation the EntryPoint refuses for a reason that has nothing to do with the
 * signature being wrong.
 */
describe('the placeholder the relayer sizes gas with', () => {
  it.each<[string, PublishedAssertion]>([
    ['Safari', SAFARI_ASSERTION],
    ['Chrome', CHROME_ASSERTION],
  ])('is at least as long as the real %s envelope', (_browser, vector) => {
    const real = encodeAssertion(assertionFromResponse(vector));

    expect(size(PLACEHOLDER_ASSERTION_SIGNATURE)).toBeGreaterThanOrEqual(size(real));
  });

  it('is at least as expensive in calldata as the real Chrome envelope', () => {
    const real = encodeAssertion(assertionFromResponse(CHROME_ASSERTION));

    expect(calldataGasOf(PLACEHOLDER_ASSERTION_SIGNATURE)).toBeGreaterThanOrEqual(
      calldataGasOf(real),
    );
  });
});

/** EIP-2028 pricing, the same arithmetic `estimatePreVerificationGas` applies. */
function calldataGasOf(data: `0x${string}`): number {
  const bytes = data.slice(2);
  let total = 0;

  for (let i = 0; i < bytes.length; i += 2) {
    total += bytes.slice(i, i + 2) === '00' ? 4 : 16;
  }

  return total;
}
