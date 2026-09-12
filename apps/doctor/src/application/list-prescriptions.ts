import {
  PrescriptionStatus,
  type Address,
  type Bytes32,
  type Hex,
  type PrescriptionRecord,
} from '@recetas/shared';
import type { IssueRejection } from '../domain/issuance';
import {
  ChainUnreachableError,
  type ChainPort,
  type IssuedPrescriptionLog,
} from '../ports/chain.port';

/**
 * Screen D7, "Mis recetas": the four states, and "Dispensada" without a single
 * available action (docs/17, docs/18 Fase 6).
 *
 * HOW THE PRESCRIBER'S RECETAS ARE FOUND. The contract has no
 * `prescriptionsOf(address)` view, so there is no index to read. What it does
 * have is `PrescriptionIssued(bytes32 indexed contentHash, address indexed
 * prescriber, ...)`: `prescriber` is an indexed topic, so `eth_getLogs` filtered
 * by it IS the query, and the doctor's own address is the key. Each log then
 * needs one `getPrescription` call to learn the CURRENT state, because the event
 * only records the issuance and says nothing about what happened afterwards.
 *
 * What that costs, stated plainly rather than hidden:
 *  - it is N+1 calls, one read per prescription;
 *  - public RPC providers cap `eth_getLogs` block ranges (commonly 10k blocks),
 *    so `fromBlock` has to be the registry's deployment block once the contract
 *    is deployed — `ViemChainAdapterOptions.fromBlock` exists for that;
 *  - a node that prunes logs answers with fewer recetas than exist, and this
 *    screen would under-report without failing. An indexer is the real answer.
 *
 * TODO (docs/18, Fase 6 D7): revisit once the registry is deployed and the
 * deployment block is known; an indexer or a subgraph replaces this port method
 * without touching the projection below.
 */

/**
 * The four states of D7.
 *
 * "Caducada" is CLIENT-DERIVED and is not a value of the on-chain enum: the
 * stored status stays `Issued` and expiry is the condition
 * `referenceTimestamp >= expiresAt` evaluated against BLOCK time (docs/04,
 * docs/17). An interface that waits for an enum value that never arrives shows
 * "Emitida" over an expired receta, and the doctor finds out when the pharmacy
 * transaction fails.
 */
export type PrescriptionListState = 'issued' | 'expired' | 'dispensed' | 'cancelled';

/** Colour is never the only carrier of meaning: every state has a word (docs/17). */
export const PRESCRIPTION_STATE_LABEL_ES: Record<PrescriptionListState, string> = {
  issued: 'Emitida',
  expired: 'Caducada',
  dispensed: 'Dispensada',
  cancelled: 'Anulada',
};

/**
 * What the doctor may still do to a receta from this screen.
 *
 * TODO (docs/04, docs/17 D7): `cancel(bytes32)` exists in the contract and needs
 * its own use case and `ChainPort` method before D7 can wire this button. The
 * projection declares availability; it does not perform anything.
 */
export type PrescriptionAction = 'cancel';

/**
 * Available actions per state.
 *
 * HARD RULE (docs/04, docs/17, "No existe botón de reapertura sobre una receta
 * dispensada"): `dispensed` maps to an EMPTY list, and so do `expired` and
 * `cancelled`. A dispensation is irreversible, and an interface that offered to
 * reopen one would lie about the only property that sustains the project.
 */
const ACTIONS_BY_STATE: Record<PrescriptionListState, readonly PrescriptionAction[]> = {
  issued: ['cancel'],
  expired: [],
  dispensed: [],
  cancelled: [],
};

export interface PrescriptionListItem {
  contentHash: Bytes32;
  /** Only the commitment. No patient identifier exists on chain (docs/03). */
  patientCommitment: Bytes32;
  /** Unix seconds. */
  issuedAt: bigint;
  /** Unix seconds, midnight of the expiry day. Shown as a date, no time (D-13). */
  expiresAt: bigint;
  state: PrescriptionListState;
  /** Spanish label of `state`. */
  label: string;
  /** Present only once the receta was dispensed. */
  dispensedBy?: Address;
  dispensedAt?: bigint;
  transactionHash: Hex;
  blockNumber: bigint;
  actions: readonly PrescriptionAction[];
}

/**
 * Pure projection of one on-chain record onto its D7 row.
 *
 * `referenceTimestamp` is BLOCK time and never `Date.now()`: a workstation with
 * a skewed clock must not disagree with the contract about expiry (docs/17).
 */
export function projectPrescription(
  log: IssuedPrescriptionLog,
  record: PrescriptionRecord,
  referenceTimestamp: bigint,
): PrescriptionListItem | undefined {
  const state = stateOf(record, referenceTimestamp);
  if (state === undefined) return undefined;

  const item: PrescriptionListItem = {
    contentHash: log.contentHash,
    patientCommitment: record.patientCommitment,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    state,
    label: PRESCRIPTION_STATE_LABEL_ES[state],
    transactionHash: log.transactionHash,
    blockNumber: log.blockNumber,
    actions: ACTIONS_BY_STATE[state],
  };

  if (state === 'dispensed') {
    item.dispensedBy = record.dispensedBy;
    item.dispensedAt = record.dispensedAt;
  }

  return item;
}

function stateOf(
  record: PrescriptionRecord,
  referenceTimestamp: bigint,
): PrescriptionListState | undefined {
  switch (record.status) {
    case PrescriptionStatus.Issued:
      // The boundary is `>=`, exactly as the contract evaluates it: at
      // `expiresAt` the receta is already caducada.
      return referenceTimestamp >= record.expiresAt ? 'expired' : 'issued';
    case PrescriptionStatus.Dispensed:
      return 'dispensed';
    case PrescriptionStatus.Cancelled:
      return 'cancelled';
    // `None` means the registry has no record for a contentHash whose issuance
    // event the node just returned. That is an inconsistent answer, not a fifth
    // state: the row is dropped rather than invented.
    case PrescriptionStatus.None:
      return undefined;
    default:
      return undefined;
  }
}

export interface ListPrescriptionsDeps {
  chain: ChainPort;
}

export interface ListPrescriptionsInput {
  prescriber: Address;
}

export type ListPrescriptionsResult =
  | {
      outcome: 'listed';
      items: PrescriptionListItem[];
      /** Block time the expiry derivation used. The screen may show it. */
      referenceTimestamp: bigint;
    }
  | { outcome: 'unavailable'; reason: IssueRejection };

export type ListPrescriptions = (
  input: ListPrescriptionsInput,
) => Promise<ListPrescriptionsResult>;

export function createListPrescriptions(deps: ListPrescriptionsDeps): ListPrescriptions {
  const { chain } = deps;

  return async ({ prescriber }) => {
    try {
      const referenceTimestamp = await chain.blockTimestamp();
      const logs = await chain.issuedBy(prescriber);

      const records = await Promise.all(
        logs.map(async (log) => ({ log, record: await chain.getPrescription(log.contentHash) })),
      );

      const items = records.flatMap(({ log, record }) => {
        const item = projectPrescription(log, record, referenceTimestamp);
        return item === undefined ? [] : [item];
      });

      // Newest first: the receta just issued is the one the doctor is looking
      // for. `blockNumber` breaks ties within the same second.
      items.sort((a, b) =>
        a.issuedAt === b.issuedAt
          ? Number(b.blockNumber - a.blockNumber)
          : Number(b.issuedAt - a.issuedAt),
      );

      return { outcome: 'listed', items, referenceTimestamp };
    } catch (error) {
      return {
        outcome: 'unavailable',
        reason: {
          code: 'network-error',
          message:
            error instanceof ChainUnreachableError
              ? 'No se pudo consultar el listado de recetas en la cadena.'
              : 'La consulta a la cadena no se pudo completar.',
        },
      };
    }
  };
}
