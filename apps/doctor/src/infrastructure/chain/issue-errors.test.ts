import { describe, expect, it } from 'vitest';
import { encodeErrorResult } from 'viem';
import { prescriptionRegistryAbi } from '@recetas/chain';
import { CONTENT_HASH, EXPIRES_AT, PHARMACY, PRESCRIBER } from '../../test/fixtures';
import { decodeIssueRejection, issueRejectionForError } from './issue-errors';

/**
 * Which reverts are a verdict for the consulting room, and which are not.
 *
 * The decoding pipeline itself lives in @recetas/chain and is tested there;
 * what is asserted here is the doctor's own mapping.
 */

function revert(errorName: string, args: readonly unknown[]): { data: string } {
  return { data: encodeErrorResult({ abi: prescriptionRegistryAbi, errorName, args } as never) };
}

describe('reverts that can happen while issuing', () => {
  it('maps AlreadyIssued with its contentHash', () => {
    expect(decodeIssueRejection(revert('AlreadyIssued', [CONTENT_HASH]))).toEqual({
      code: 'already-issued',
      contentHash: CONTENT_HASH,
    });
  });

  it('maps NotAccreditedPractitioner with the account the contract refused', () => {
    expect(decodeIssueRejection(revert('NotAccreditedPractitioner', [PRESCRIBER]))).toEqual({
      code: 'practitioner-credential-missing',
      account: PRESCRIBER,
    });
  });

  it('maps InvalidExpiry with the expiry instant', () => {
    expect(decodeIssueRejection(revert('InvalidExpiry', [EXPIRES_AT]))).toEqual({
      code: 'invalid-expiry',
      expiresAt: EXPIRES_AT,
    });
  });

  it('maps an already-decoded error by name and arguments', () => {
    expect(issueRejectionForError('AlreadyIssued', [CONTENT_HASH])).toEqual({
      code: 'already-issued',
      contentHash: CONTENT_HASH,
    });
  });
});

/**
 * A revert that cannot happen to an `issue` call must not be dressed up as a
 * verdict for the doctor: returning `undefined` makes the caller rethrow
 * (docs/17, never a generic refusal).
 */
describe('reverts that cannot happen while issuing', () => {
  it.each([
    ['AlreadyDispensed', [CONTENT_HASH, PHARMACY, 1n]],
    ['UnknownPrescription', [CONTENT_HASH]],
    ['PrescriptionExpired', [CONTENT_HASH, EXPIRES_AT]],
    ['PrescriptionCancelledError', [CONTENT_HASH]],
    ['NotPrescriber', [PHARMACY, PRESCRIBER]],
    ['NotAccreditedPharmacy', [PHARMACY]],
    ['CredentialNotFound', [CONTENT_HASH]],
  ])('returns undefined for %s', (errorName, args) => {
    expect(decodeIssueRejection(revert(errorName, args))).toBeUndefined();
    expect(issueRejectionForError(errorName, args)).toBeUndefined();
  });

  it('returns undefined for anything that is not a registry revert', () => {
    expect(decodeIssueRejection(new Error('boom'))).toBeUndefined();
    expect(decodeIssueRejection(undefined)).toBeUndefined();
    expect(issueRejectionForError('SomethingElse', [])).toBeUndefined();
  });
});
