import { describe, expect, it } from 'vitest';
import type { Bytes32 } from '@recetas/shared';
import { ChainUnreachableError, type ChainPort } from '../ports/chain.port';
import { BLOCK_TIME, CONFIG, CREDENTIAL_UID, PRESCRIBER, ZERO_UID, aRecord } from '../test/fixtures';
import { createCheckCredential } from './check-credential';

/** Screen D1: the credential is checked before the form is enabled (docs/17). */

function fakeChain(credentialOf: () => Promise<Bytes32>): ChainPort {
  return {
    blockTimestamp: async () => BLOCK_TIME,
    credentialOf,
    getPrescription: async () => aRecord(),
    issuedBy: async () => [],
    issue: async () => {
      throw new Error('issue is not part of the credential check');
    },
  };
}

describe('the credential check', () => {
  it('accredits an account that registered a credential uid', async () => {
    const check = createCheckCredential({ chain: fakeChain(async () => CREDENTIAL_UID) });

    expect(await check({ account: PRESCRIBER })).toEqual({
      accredited: true,
      account: PRESCRIBER,
      uid: CREDENTIAL_UID,
    });
  });

  it('refuses an account that never registered one', async () => {
    const check = createCheckCredential({ chain: fakeChain(async () => ZERO_UID) });

    expect(await check({ account: PRESCRIBER })).toEqual({
      accredited: false,
      account: PRESCRIBER,
      reason: { code: 'practitioner-credential-missing', account: PRESCRIBER },
    });
  });

  it('reports an unreachable node as a network failure, not as a missing credential', async () => {
    const check = createCheckCredential({
      chain: fakeChain(async () => {
        throw new ChainUnreachableError(CONFIG.rpcUrl);
      }),
    });

    expect(await check({ account: PRESCRIBER })).toEqual({
      accredited: false,
      account: PRESCRIBER,
      reason: {
        code: 'network-error',
        message: 'No se pudo comprobar la credencial médica en la cadena.',
      },
    });
  });
});
