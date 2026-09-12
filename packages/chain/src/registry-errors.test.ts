import { describe, expect, it } from 'vitest';
import { BaseError, ContractFunctionRevertedError, encodeErrorResult, type Hex } from 'viem';
import { prescriptionRegistryAbi } from './registry-abi';
import {
  ZERO_ADDRESS,
  decodeRegistryError,
  decodeRegistryRevertData,
  toRegistryRevert,
} from './registry-errors';

/**
 * Every custom error of PrescriptionRegistry has to come back structured, with
 * the arguments it carries (docs/04, docs/17 P6 and P7).
 *
 * `AlreadyDispensed` and `PrescriptionExpired` are the two that matter most:
 * losing an argument there is what turns "ya fue dispensada el 11/09/2026 a las
 * 09:42 por otra farmacia" back into a generic shrug.
 */

const CONTENT_HASH = '0x11'.padEnd(66, '1') as Hex;
const CREDENTIAL_UID = '0x22'.padEnd(66, '2') as Hex;
const SCHEMA = '0x33'.padEnd(66, '3') as Hex;
const PHARMACY = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
const PRESCRIBER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' as const;
const OTHER_ACCOUNT = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as const;
const DISPENSED_AT = 1_757_600_000n;
const EXPIRES_AT = 1_760_000_000n;

/** Wraps encoded revert data the way a node hands it back. */
function revertWith(errorName: string, args: readonly unknown[]): { data: Hex } {
  return {
    data: encodeErrorResult({ abi: prescriptionRegistryAbi, errorName, args } as never),
  };
}

describe('decoding one revert per custom error', () => {
  it('AlreadyDispensed carries contentHash, dispensedBy and dispensedAt', () => {
    expect(
      decodeRegistryError(revertWith('AlreadyDispensed', [CONTENT_HASH, PHARMACY, DISPENSED_AT])),
    ).toEqual({
      name: 'AlreadyDispensed',
      contentHash: CONTENT_HASH,
      dispensedBy: PHARMACY,
      dispensedAt: DISPENSED_AT,
    });
  });

  it('PrescriptionExpired carries contentHash and expiresAt', () => {
    expect(
      decodeRegistryError(revertWith('PrescriptionExpired', [CONTENT_HASH, EXPIRES_AT])),
    ).toEqual({
      name: 'PrescriptionExpired',
      contentHash: CONTENT_HASH,
      expiresAt: EXPIRES_AT,
    });
  });

  it('AlreadyIssued carries the contentHash', () => {
    expect(decodeRegistryError(revertWith('AlreadyIssued', [CONTENT_HASH]))).toEqual({
      name: 'AlreadyIssued',
      contentHash: CONTENT_HASH,
    });
  });

  it('UnknownPrescription carries the contentHash', () => {
    expect(decodeRegistryError(revertWith('UnknownPrescription', [CONTENT_HASH]))).toEqual({
      name: 'UnknownPrescription',
      contentHash: CONTENT_HASH,
    });
  });

  it('PrescriptionCancelledError carries the contentHash', () => {
    expect(decodeRegistryError(revertWith('PrescriptionCancelledError', [CONTENT_HASH]))).toEqual({
      name: 'PrescriptionCancelledError',
      contentHash: CONTENT_HASH,
    });
  });

  it('NotAccreditedPractitioner names the caller', () => {
    expect(decodeRegistryError(revertWith('NotAccreditedPractitioner', [PRESCRIBER]))).toEqual({
      name: 'NotAccreditedPractitioner',
      caller: PRESCRIBER,
    });
  });

  it('NotAccreditedPharmacy names the caller', () => {
    expect(decodeRegistryError(revertWith('NotAccreditedPharmacy', [PHARMACY]))).toEqual({
      name: 'NotAccreditedPharmacy',
      caller: PHARMACY,
    });
  });

  it('NotPrescriber names both the caller and the prescriber', () => {
    expect(decodeRegistryError(revertWith('NotPrescriber', [PHARMACY, PRESCRIBER]))).toEqual({
      name: 'NotPrescriber',
      caller: PHARMACY,
      prescriber: PRESCRIBER,
    });
  });

  it('InvalidExpiry carries the rejected expiry', () => {
    expect(decodeRegistryError(revertWith('InvalidExpiry', [EXPIRES_AT]))).toEqual({
      name: 'InvalidExpiry',
      expiresAt: EXPIRES_AT,
    });
  });

  it('InvalidCredentialUid carries nothing but its name', () => {
    expect(decodeRegistryError(revertWith('InvalidCredentialUid', []))).toEqual({
      name: 'InvalidCredentialUid',
    });
  });

  it('CredentialNotFound carries the uid', () => {
    expect(decodeRegistryError(revertWith('CredentialNotFound', [CREDENTIAL_UID]))).toEqual({
      name: 'CredentialNotFound',
      uid: CREDENTIAL_UID,
    });
  });

  it('CredentialNotForCaller names the caller and the recipient', () => {
    expect(
      decodeRegistryError(revertWith('CredentialNotForCaller', [PHARMACY, OTHER_ACCOUNT])),
    ).toEqual({
      name: 'CredentialNotForCaller',
      caller: PHARMACY,
      recipient: OTHER_ACCOUNT,
    });
  });

  it('CredentialWrongIssuer names the attester and the expected issuer', () => {
    expect(
      decodeRegistryError(revertWith('CredentialWrongIssuer', [OTHER_ACCOUNT, PRESCRIBER])),
    ).toEqual({
      name: 'CredentialWrongIssuer',
      attester: OTHER_ACCOUNT,
      expectedIssuer: PRESCRIBER,
    });
  });

  it('CredentialUnknownSchema carries the schema', () => {
    expect(decodeRegistryError(revertWith('CredentialUnknownSchema', [SCHEMA]))).toEqual({
      name: 'CredentialUnknownSchema',
      schema: SCHEMA,
    });
  });

  it('CredentialRevoked carries the uid and the revocation time', () => {
    expect(
      decodeRegistryError(revertWith('CredentialRevoked', [CREDENTIAL_UID, DISPENSED_AT])),
    ).toEqual({
      name: 'CredentialRevoked',
      uid: CREDENTIAL_UID,
      revocationTime: DISPENSED_AT,
    });
  });

  it('CredentialExpired carries the uid and the expiration time', () => {
    expect(
      decodeRegistryError(revertWith('CredentialExpired', [CREDENTIAL_UID, EXPIRES_AT])),
    ).toEqual({
      name: 'CredentialExpired',
      uid: CREDENTIAL_UID,
      expirationTime: EXPIRES_AT,
    });
  });
});

describe('the paths a revert can arrive by', () => {
  // What `simulateContract` raises: the decoded error is already inside a
  // BaseError chain, and no raw data blob is present at the top level.
  it('walks a BaseError chain to the ContractFunctionRevertedError', () => {
    const reverted = new ContractFunctionRevertedError({
      abi: prescriptionRegistryAbi as never,
      data: revertWith('AlreadyDispensed', [CONTENT_HASH, PHARMACY, DISPENSED_AT]).data,
      functionName: 'dispense',
    });
    const wrapped = new BaseError('reverted', { cause: reverted });

    expect(decodeRegistryError(wrapped)).toEqual({
      name: 'AlreadyDispensed',
      contentHash: CONTENT_HASH,
      dispensedBy: PHARMACY,
      dispensedAt: DISPENSED_AT,
    });
  });

  // What some nodes return when the estimation path is skipped: a bare blob,
  // buried as deep in the cause chain as the transport felt like putting it.
  it('finds raw revert data nested in a cause chain', () => {
    const nested = { cause: { cause: revertWith('UnknownPrescription', [CONTENT_HASH]) } };

    expect(decodeRegistryError(nested)).toEqual({
      name: 'UnknownPrescription',
      contentHash: CONTENT_HASH,
    });
  });

  it('decodes raw revert data sitting directly on the error', () => {
    expect(decodeRegistryError(revertWith('PrescriptionCancelledError', [CONTENT_HASH]))).toEqual({
      name: 'PrescriptionCancelledError',
      contentHash: CONTENT_HASH,
    });
  });
});

describe('inputs that are not registry reverts', () => {
  it.each([
    ['a plain error', new Error('boom')],
    ['undefined', undefined],
    ['null', null],
    ['a string', 'nope'],
    ['a number', 42],
    ['an object with no data and no cause', {}],
    ['revert data too short to hold a selector', { data: '0xdead' }],
    ['unknown revert data', { data: '0xdeadbeef' }],
    ['a cause chain that ends nowhere', { cause: { cause: { message: 'nope' } } }],
  ])('returns undefined for %s', (_label, input) => {
    expect(decodeRegistryError(input)).toBeUndefined();
  });
});

describe('toRegistryRevert', () => {
  // The arguments come from a decoder, not from this codebase: a node that
  // hands back fewer than declared must not throw mid-verdict.
  it('defends against missing arguments instead of throwing', () => {
    expect(toRegistryRevert('AlreadyDispensed', undefined)).toEqual({
      name: 'AlreadyDispensed',
      contentHash: '0x',
      dispensedBy: ZERO_ADDRESS,
      dispensedAt: 0n,
    });
  });

  it('defends against arguments of the wrong shape', () => {
    expect(toRegistryRevert('NotPrescriber', [42, null])).toEqual({
      name: 'NotPrescriber',
      caller: ZERO_ADDRESS,
      prescriber: ZERO_ADDRESS,
    });
  });

  it('returns undefined for an error name the registry does not declare', () => {
    expect(toRegistryRevert('SomethingNobodyWrote', [])).toBeUndefined();
  });
});

describe('decodeRegistryRevertData', () => {
  // The raw pair exists for callers that still have something to say about an
  // error this registry does not declare; `decodeRegistryError` drops those.
  it('returns the name and arguments without interpreting them', () => {
    expect(
      decodeRegistryRevertData(revertWith('PrescriptionExpired', [CONTENT_HASH, EXPIRES_AT])),
    ).toEqual({
      errorName: 'PrescriptionExpired',
      args: [CONTENT_HASH, EXPIRES_AT],
    });
  });

  it('returns undefined when nothing decodable is in the error', () => {
    expect(decodeRegistryRevertData(new Error('boom'))).toBeUndefined();
  });
});
