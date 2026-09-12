import { describe, expect, it } from 'vitest';
import type { Bytes32, PrescriptionRecord, VerificationResult } from '@recetas/shared';
import { ChainUnreachableError, type ChainPort } from '../ports/chain.port';
import { CREDENTIAL_UID, PHARMACY_A, ZERO_UID, aRecord } from '../test/fixtures';
import { ZERO_UID as ZERO_UID_CONSTANT, createCheckCredential } from './check-credential';

/** Screen P1: the credential is checked before the scanner opens (docs/17). */

function fakeChain(credentialOf: () => Promise<Bytes32>): ChainPort {
  return {
    blockTimestamp: async () => 0n,
    verify: async (): Promise<VerificationResult> => {
      throw new Error('verify is not part of the credential use case');
    },
    getPrescription: async (): Promise<PrescriptionRecord> => aRecord(),
    credentialOf,
    dispense: async () => {
      throw new Error('the credential check never dispenses');
    },
  };
}

describe('an accredited pharmacy', () => {
  it('returns the registered uid', async () => {
    const check = createCheckCredential({ chain: fakeChain(async () => CREDENTIAL_UID) });

    expect(await check({ account: PHARMACY_A })).toEqual({
      accredited: true,
      account: PHARMACY_A,
      uid: CREDENTIAL_UID,
    });
  });
});

describe('an account with no credential', () => {
  it('rejects with pharmacy-credential-revoked and names the account', async () => {
    const check = createCheckCredential({ chain: fakeChain(async () => ZERO_UID) });

    expect(await check({ account: PHARMACY_A })).toEqual({
      accredited: false,
      account: PHARMACY_A,
      reason: { code: 'pharmacy-credential-revoked', account: PHARMACY_A },
    });
  });

  it('recognises the zero uid whatever its case', async () => {
    const upper = ZERO_UID.toUpperCase().replace('0X', '0x') as Bytes32;
    const check = createCheckCredential({ chain: fakeChain(async () => upper) });

    const status = await check({ account: PHARMACY_A });

    expect(status.accredited).toBe(false);
  });

  it('exports the zero uid the registry returns', () => {
    expect(ZERO_UID_CONSTANT).toBe(ZERO_UID);
  });
});

describe('an unreachable node', () => {
  it('reports a network error rather than declaring the credential revoked', async () => {
    const check = createCheckCredential({
      chain: fakeChain(async () => {
        throw new ChainUnreachableError('http://localhost:8545');
      }),
    });

    const status = await check({ account: PHARMACY_A });

    expect(status.accredited).toBe(false);
    if (status.accredited) throw new Error('expected a refusal');
    expect(status.reason.code).toBe('network-error');
  });
});
