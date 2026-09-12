import { describe, expect, it } from 'vitest';
import { encodeErrorResult } from 'viem';
import {
  CONTENT_HASH,
  CREDENTIAL_UID,
  DISPENSED_AT,
  EXPIRES_AT,
  PHARMACY_A,
  PRESCRIBER,
} from '../../test/fixtures';
import { prescriptionRegistryAbi } from './registry-abi';
import { decodeRegistryRejection, rejectionForError } from './registry-errors';

/**
 * Each custom error of PrescriptionRegistry has to land on its own rejection
 * code, with the evidence the screen needs (docs/04, docs/17 P6 and P7).
 */

/** Wraps encoded revert data the way a node hands it back. */
function revertWith(errorName: string, args: readonly unknown[]): { data: string } {
  return {
    data: encodeErrorResult({
      abi: prescriptionRegistryAbi,
      errorName,
      args,
    } as never),
  };
}

describe('decoding the errors a pharmacy can hit', () => {
  it('AlreadyDispensed carries dispensedBy and dispensedAt', () => {
    const reason = decodeRegistryRejection(
      revertWith('AlreadyDispensed', [CONTENT_HASH, PHARMACY_A, DISPENSED_AT]),
    );

    expect(reason).toEqual({
      code: 'already-dispensed',
      dispensedBy: PHARMACY_A,
      dispensedAt: DISPENSED_AT,
    });
  });

  it('PrescriptionExpired carries expiresAt', () => {
    const reason = decodeRegistryRejection(
      revertWith('PrescriptionExpired', [CONTENT_HASH, EXPIRES_AT]),
    );

    expect(reason).toEqual({ code: 'expired', expiresAt: EXPIRES_AT });
  });

  it('PrescriptionCancelledError maps to cancelled', () => {
    expect(decodeRegistryRejection(revertWith('PrescriptionCancelledError', [CONTENT_HASH]))).toEqual(
      { code: 'cancelled' },
    );
  });

  it('UnknownPrescription maps to unknown-prescription', () => {
    expect(decodeRegistryRejection(revertWith('UnknownPrescription', [CONTENT_HASH]))).toEqual({
      code: 'unknown-prescription',
    });
  });

  it('NotAccreditedPharmacy maps to pharmacy-credential-revoked and names the account', () => {
    expect(decodeRegistryRejection(revertWith('NotAccreditedPharmacy', [PHARMACY_A]))).toEqual({
      code: 'pharmacy-credential-revoked',
      account: PHARMACY_A,
    });
  });
});

describe('errors a pharmacy cannot cause', () => {
  // Inventing a verdict for the counter out of an error nobody modelled is
  // exactly the generic shrug docs/17 forbids: these must stay undecoded so the
  // caller rethrows.
  it.each([
    ['AlreadyIssued', [CONTENT_HASH]],
    ['NotAccreditedPractitioner', [PRESCRIBER]],
    ['NotPrescriber', [PHARMACY_A, PRESCRIBER]],
    ['InvalidExpiry', [EXPIRES_AT]],
    ['CredentialNotFound', [CREDENTIAL_UID]],
  ] as const)('leaves %s undecoded', (name, args) => {
    expect(decodeRegistryRejection(revertWith(name, args as readonly unknown[]))).toBeUndefined();
  });
});

describe('inputs that are not registry reverts', () => {
  it.each([
    ['a plain error', new Error('boom')],
    ['undefined', undefined],
    ['null', null],
    ['a string', 'nope'],
    ['unknown revert data', { data: '0xdeadbeef' }],
  ])('returns undefined for %s', (_label, input) => {
    expect(decodeRegistryRejection(input)).toBeUndefined();
  });

  it('finds revert data nested in a cause chain', () => {
    const nested = { cause: { cause: revertWith('UnknownPrescription', [CONTENT_HASH]) } };
    expect(decodeRegistryRejection(nested)).toEqual({ code: 'unknown-prescription' });
  });
});

describe('rejectionForError', () => {
  it('defends against missing arguments instead of throwing', () => {
    expect(rejectionForError('AlreadyDispensed', undefined)).toEqual({
      code: 'already-dispensed',
      dispensedBy: '0x0000000000000000000000000000000000000000',
      dispensedAt: 0n,
    });
  });

  it('returns undefined for an error name that is not in the ABI', () => {
    expect(rejectionForError('SomethingNobodyWrote', [])).toBeUndefined();
  });
});
