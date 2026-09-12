import { describe, expect, it, vi } from 'vitest';
import { encodeErrorResult } from 'viem';
import type { Address, Bytes32, PrescriptionRecord, VerificationResult } from '@recetas/shared';
import { prescriptionRegistryAbi } from '../infrastructure/chain/registry-abi';
import { ChainUnreachableError, type ChainPort, type DispenseReceipt } from '../ports/chain.port';
import { SignerRejectedError } from '../ports/signer.port';
import {
  BLOCK_TIME,
  CONTENT_HASH,
  DISPENSED_AT,
  EXPIRES_AT,
  PHARMACY_A,
  PHARMACY_B,
  aRecord,
} from '../test/fixtures';
import { createDispensePrescription } from './dispense-prescription';

/**
 * Dispensing is the irreversible act (docs/04, docs/17 P4 and P5).
 */

interface FakeChainOverrides {
  blockTimestamp?: () => Promise<bigint>;
  dispense?: (contentHash: Bytes32, pharmacy: Address) => Promise<DispenseReceipt>;
}

const RECEIPT: DispenseReceipt = {
  transactionHash: '0xabc0000000000000000000000000000000000000000000000000000000000001',
  blockNumber: 42n,
  blockTimestamp: DISPENSED_AT,
  dispensedBy: PHARMACY_A,
};

function fakeChain(overrides: FakeChainOverrides = {}): ChainPort {
  return {
    blockTimestamp: overrides.blockTimestamp ?? (async () => BLOCK_TIME),
    verify: async (): Promise<VerificationResult> => {
      throw new Error('verify is not part of the dispense use case');
    },
    getPrescription: async (): Promise<PrescriptionRecord> => aRecord(),
    credentialOf: async () => '0x0' as Bytes32,
    dispense: overrides.dispense ?? (async () => RECEIPT),
  };
}

function revert(errorName: string, args: readonly unknown[]): { data: string } {
  return { data: encodeErrorResult({ abi: prescriptionRegistryAbi, errorName, args } as never) };
}

const INPUT = { contentHash: CONTENT_HASH, pharmacy: PHARMACY_A, expiresAt: EXPIRES_AT };

describe('the happy path', () => {
  it('returns the transaction hash and block timestamp the P5 receipt needs', async () => {
    const dispense = createDispensePrescription({ chain: fakeChain() });

    const result = await dispense(INPUT);

    expect(result).toEqual({ outcome: 'dispensed', receipt: RECEIPT });
  });

  it('sends nothing but the contentHash and the pharmacy account to the chain', async () => {
    const spy = vi.fn(async () => RECEIPT);
    const dispense = createDispensePrescription({ chain: fakeChain({ dispense: spy }) });

    await dispense(INPUT);

    expect(spy).toHaveBeenCalledWith(CONTENT_HASH, PHARMACY_A);
  });
});

describe('expiry, derived before any gas is spent', () => {
  it('refuses locally at expiresAt without calling the contract', async () => {
    const spy = vi.fn(async () => RECEIPT);
    const dispense = createDispensePrescription({
      chain: fakeChain({ blockTimestamp: async () => EXPIRES_AT, dispense: spy }),
    });

    const result = await dispense(INPUT);

    expect(result).toEqual({ outcome: 'rejected', reason: { code: 'expired', expiresAt: EXPIRES_AT } });
    expect(spy).not.toHaveBeenCalled();
  });

  it('still dispenses one second before expiresAt', async () => {
    const dispense = createDispensePrescription({
      chain: fakeChain({ blockTimestamp: async () => EXPIRES_AT - 1n }),
    });

    expect((await dispense(INPUT)).outcome).toBe('dispensed');
  });

  // The clock/block race: the local guard passed, the block advanced, and the
  // contract reverted. Both paths must land on the same reason (docs/04).
  it('lands on the same expired reason when the contract reverts with PrescriptionExpired', async () => {
    const dispense = createDispensePrescription({
      chain: fakeChain({
        dispense: async () => {
          throw revert('PrescriptionExpired', [CONTENT_HASH, EXPIRES_AT]);
        },
      }),
    });

    const result = await dispense(INPUT);

    expect(result).toEqual({
      outcome: 'rejected',
      reason: { code: 'expired', expiresAt: EXPIRES_AT },
    });
  });
});

describe('contract reverts', () => {
  it('surfaces dispensedBy and dispensedAt from AlreadyDispensed', async () => {
    const dispense = createDispensePrescription({
      chain: fakeChain({
        dispense: async () => {
          throw revert('AlreadyDispensed', [CONTENT_HASH, PHARMACY_B, DISPENSED_AT]);
        },
      }),
    });

    const result = await dispense(INPUT);

    expect(result).toEqual({
      outcome: 'rejected',
      reason: { code: 'already-dispensed', dispensedBy: PHARMACY_B, dispensedAt: DISPENSED_AT },
    });
  });

  it('maps NotAccreditedPharmacy to pharmacy-credential-revoked', async () => {
    const dispense = createDispensePrescription({
      chain: fakeChain({
        dispense: async () => {
          throw revert('NotAccreditedPharmacy', [PHARMACY_A]);
        },
      }),
    });

    const result = await dispense(INPUT);

    expect(result).toEqual({
      outcome: 'rejected',
      reason: { code: 'pharmacy-credential-revoked', account: PHARMACY_A },
    });
  });

  it('maps PrescriptionCancelledError to cancelled', async () => {
    const dispense = createDispensePrescription({
      chain: fakeChain({
        dispense: async () => {
          throw revert('PrescriptionCancelledError', [CONTENT_HASH]);
        },
      }),
    });

    expect(await dispense(INPUT)).toEqual({
      outcome: 'rejected',
      reason: { code: 'cancelled' },
    });
  });

  it('rethrows an error nobody modelled instead of inventing a verdict', async () => {
    const dispense = createDispensePrescription({
      chain: fakeChain({
        dispense: async () => {
          throw new Error('something nobody wrote down');
        },
      }),
    });

    await expect(dispense(INPUT)).rejects.toThrow('something nobody wrote down');
  });
});

describe('the person at the counter', () => {
  it('reports an abort, not a rejection, when the confirmation is declined', async () => {
    const dispense = createDispensePrescription({
      chain: fakeChain({
        dispense: async () => {
          throw new SignerRejectedError();
        },
      }),
    });

    expect(await dispense(INPUT)).toEqual({ outcome: 'aborted' });
  });
});

describe('an unreachable node', () => {
  it('reports a network error instead of a verdict about the receta', async () => {
    const dispense = createDispensePrescription({
      chain: fakeChain({
        blockTimestamp: async () => {
          throw new ChainUnreachableError('http://localhost:8545');
        },
      }),
    });

    const result = await dispense(INPUT);

    expect(result.outcome).toBe('rejected');
    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    expect(result.reason.code).toBe('network-error');
  });

  it('says the delivery was not registered when the write itself failed', async () => {
    const dispense = createDispensePrescription({
      chain: fakeChain({
        dispense: async () => {
          throw new ChainUnreachableError('http://localhost:8545');
        },
      }),
    });

    const result = await dispense(INPUT);

    if (result.outcome !== 'rejected') throw new Error('expected a rejection');
    expect(result.reason).toEqual({
      code: 'network-error',
      message: 'No hay respuesta de la cadena, así que la entrega no quedó registrada.',
    });
  });
});

describe('the shape of the use case', () => {
  // docs/04, docs/17: the contract has no reopen path and neither does this.
  it('exposes no operation that could undo a dispensation', () => {
    const dispense = createDispensePrescription({ chain: fakeChain() });

    expect(typeof dispense).toBe('function');
    expect(Object.keys(dispense)).toEqual([]);
  });
});
