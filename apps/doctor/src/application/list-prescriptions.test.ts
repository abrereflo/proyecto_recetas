import { describe, expect, it } from 'vitest';
import { PrescriptionStatus, type Bytes32, type PrescriptionRecord } from '@recetas/shared';
import { ChainUnreachableError, type ChainPort, type IssuedPrescriptionLog } from '../ports/chain.port';
import {
  BLOCK_TIME,
  CONFIG,
  CONTENT_HASH,
  CREDENTIAL_UID,
  DISPENSED_AT,
  EXPIRES_AT,
  PHARMACY,
  PRESCRIBER,
  aLog,
  aRecord,
} from '../test/fixtures';
import { createListPrescriptions, projectPrescription } from './list-prescriptions';

/**
 * Screen D7: the four states, with "Caducada" derived on the client and
 * "Dispensada" without a single available action (docs/17, docs/18 Fase 6).
 */

const OTHER_HASH = '0xdead000000000000000000000000000000000000000000000000000000000001' as Bytes32;

interface FakeChainOverrides {
  blockTimestamp?: () => Promise<bigint>;
  issuedBy?: () => Promise<IssuedPrescriptionLog[]>;
  records?: Map<string, PrescriptionRecord>;
}

function fakeChain(overrides: FakeChainOverrides = {}): ChainPort {
  const records = overrides.records ?? new Map([[CONTENT_HASH, aRecord()]]);

  return {
    blockTimestamp: overrides.blockTimestamp ?? (async () => BLOCK_TIME),
    credentialOf: async () => CREDENTIAL_UID,
    issuedBy: overrides.issuedBy ?? (async () => [aLog()]),
    getPrescription: async (contentHash) => {
      const record = records.get(contentHash);
      if (record === undefined) throw new Error(`no record for ${contentHash}`);
      return record;
    },
    issue: async () => {
      throw new Error('issue is not part of the listing use case');
    },
  };
}

describe('the state projection', () => {
  it('shows an issued prescription inside its validity window as Emitida', () => {
    const item = projectPrescription(aLog(), aRecord(), BLOCK_TIME);

    expect(item).toMatchObject({ state: 'issued', label: 'Emitida' });
  });

  /**
   * "Caducada" is CLIENT-DERIVED: the stored enum value is still `Issued`
   * (docs/04, docs/17). An interface waiting for an enum value that never
   * arrives would show "Emitida" over an expired receta.
   */
  it('derives Caducada from block time at the exact expiry instant', () => {
    const atExpiry = projectPrescription(aLog(), aRecord(), EXPIRES_AT);
    const oneSecondBefore = projectPrescription(aLog(), aRecord(), EXPIRES_AT - 1n);

    expect(atExpiry).toMatchObject({ state: 'expired', label: 'Caducada' });
    expect(oneSecondBefore).toMatchObject({ state: 'issued', label: 'Emitida' });
  });

  it('never reads Caducada off the contract enum', () => {
    // The record is `Issued`; only the comparison against block time changes.
    const record = aRecord({ status: PrescriptionStatus.Issued });

    expect(projectPrescription(aLog(), record, EXPIRES_AT + 3_600n)?.state).toBe('expired');
  });

  it('shows a dispensed prescription with who and when', () => {
    const record = aRecord({
      status: PrescriptionStatus.Dispensed,
      dispensedBy: PHARMACY,
      dispensedAt: DISPENSED_AT,
    });

    expect(projectPrescription(aLog(), record, BLOCK_TIME)).toMatchObject({
      state: 'dispensed',
      label: 'Dispensada',
      dispensedBy: PHARMACY,
      dispensedAt: DISPENSED_AT,
    });
  });

  /**
   * HARD RULE (docs/04, docs/17): "No existe botón de reapertura sobre una
   * receta dispensada." The empty list is the enforcement.
   */
  it('offers no action at all on a dispensed prescription', () => {
    const record = aRecord({
      status: PrescriptionStatus.Dispensed,
      dispensedBy: PHARMACY,
      dispensedAt: DISPENSED_AT,
    });

    expect(projectPrescription(aLog(), record, BLOCK_TIME)?.actions).toEqual([]);
  });

  it('keeps a dispensed prescription actionless even past its expiry', () => {
    const record = aRecord({
      status: PrescriptionStatus.Dispensed,
      dispensedBy: PHARMACY,
      dispensedAt: DISPENSED_AT,
    });

    const item = projectPrescription(aLog(), record, EXPIRES_AT + 1n);

    expect(item).toMatchObject({ state: 'dispensed', actions: [] });
  });

  it('offers no action on an expired or cancelled prescription either', () => {
    expect(projectPrescription(aLog(), aRecord(), EXPIRES_AT)?.actions).toEqual([]);
    expect(
      projectPrescription(aLog(), aRecord({ status: PrescriptionStatus.Cancelled }), BLOCK_TIME)
        ?.actions,
    ).toEqual([]);
  });

  it('shows a cancelled prescription as Anulada', () => {
    const record = aRecord({ status: PrescriptionStatus.Cancelled });

    expect(projectPrescription(aLog(), record, BLOCK_TIME)).toMatchObject({
      state: 'cancelled',
      label: 'Anulada',
    });
  });

  it('drops a log whose record the registry does not have', () => {
    const record = aRecord({ status: PrescriptionStatus.None });

    expect(projectPrescription(aLog(), record, BLOCK_TIME)).toBeUndefined();
  });

  it('surfaces only the commitment, never a patient identifier', () => {
    const item = projectPrescription(aLog(), aRecord(), BLOCK_TIME);

    expect(Object.keys(item ?? {}).sort()).toEqual([
      'actions',
      'blockNumber',
      'contentHash',
      'expiresAt',
      'issuedAt',
      'label',
      'patientCommitment',
      'state',
      'transactionHash',
    ]);
  });
});

describe('listing the prescriber own recetas', () => {
  it('reads the issuance events filtered by the prescriber and resolves each state', async () => {
    const list = createListPrescriptions({ chain: fakeChain() });

    const result = await list({ prescriber: PRESCRIBER });

    expect(result).toEqual({
      outcome: 'listed',
      referenceTimestamp: BLOCK_TIME,
      items: [expect.objectContaining({ state: 'issued', contentHash: CONTENT_HASH })],
    });
  });

  it('returns the newest prescription first', async () => {
    const list = createListPrescriptions({
      chain: fakeChain({
        issuedBy: async () => [
          aLog({ contentHash: CONTENT_HASH, blockNumber: 10n }),
          aLog({ contentHash: OTHER_HASH, blockNumber: 20n }),
        ],
        records: new Map([
          [CONTENT_HASH, aRecord({ issuedAt: 1_789_000_000n })],
          [OTHER_HASH, aRecord({ issuedAt: 1_789_100_000n })],
        ]),
      }),
    });

    const result = await list({ prescriber: PRESCRIBER });

    expect(result.outcome).toBe('listed');
    if (result.outcome !== 'listed') return;
    expect(result.items.map((item) => item.contentHash)).toEqual([OTHER_HASH, CONTENT_HASH]);
  });

  it('answers with an empty list when this prescriber issued nothing', async () => {
    const list = createListPrescriptions({ chain: fakeChain({ issuedBy: async () => [] }) });

    const result = await list({ prescriber: PRESCRIBER });

    expect(result).toEqual({ outcome: 'listed', items: [], referenceTimestamp: BLOCK_TIME });
  });

  it('reports an unreachable node as unavailable, never as an empty list', async () => {
    const list = createListPrescriptions({
      chain: fakeChain({
        blockTimestamp: async () => {
          throw new ChainUnreachableError(CONFIG.rpcUrl);
        },
      }),
    });

    expect(await list({ prescriber: PRESCRIBER })).toEqual({
      outcome: 'unavailable',
      reason: {
        code: 'network-error',
        message: 'No se pudo consultar el listado de recetas en la cadena.',
      },
    });
  });
});
