import type { Address, Bytes32, Hex, PrescriptionRecord } from '@recetas/shared';

/**
 * Everything the doctor SPA needs from `PrescriptionRegistry`, as an interface.
 *
 * The single write is `issue`: anchoring the prescription. There is deliberately
 * no `dispense` here — dispensing belongs to the pharmacy, and a doctor-side
 * interface that exposed it would invite a screen that has no right to exist
 * (docs/04, docs/17).
 *
 * HARD RULE (docs/03, docs/17 "Ningún identificador de paciente llega a la
 * cadena"): the only patient-derived value in this whole interface is
 * `patientCommitment`. No `patientId` and no commitment salt appears in any
 * signature below, which is what makes the privacy rule structural instead of a
 * convention somebody has to remember.
 */

/** What screen D6 prints as the on-chain receipt of the issuance. */
export interface IssueReceipt {
  transactionHash: Hex;
  blockNumber: bigint;
  /** Unix seconds of the block that mined the issuance. */
  blockTimestamp: bigint;
}

/** Arguments of `issue(bytes32,bytes32,uint64)`, plus who signs it. */
export interface IssueRequest {
  contentHash: Bytes32;
  /** keccak256(patientId, salt). The salt itself stays off-chain (docs/03). */
  patientCommitment: Bytes32;
  /** Unix seconds, midnight of the expiry day (D-13). */
  expiresAt: bigint;
  /** The account the chain will record as `prescriber`. */
  prescriber: Address;
}

/**
 * One `PrescriptionIssued` event, as emitted by the registry.
 *
 * This is the only index the MVP has for screen D7: `prescriber` is an indexed
 * topic of the event, so the log filter is the query. See
 * application/list-prescriptions.ts for what that costs.
 */
export interface IssuedPrescriptionLog {
  contentHash: Bytes32;
  prescriber: Address;
  patientCommitment: Bytes32;
  expiresAt: bigint;
  blockNumber: bigint;
  transactionHash: Hex;
}

export interface ChainPort {
  /**
   * Latest block timestamp, Unix seconds.
   *
   * "Caducada" is derived against this value, never against the device clock
   * (docs/17): a workstation with a skewed clock must not disagree with the
   * contract about whether a prescription is still valid.
   */
  blockTimestamp(): Promise<bigint>;

  /** EAS uid this account registered, or the zero uid when it registered none. */
  credentialOf(account: Address): Promise<Bytes32>;

  /**
   * Anchors the prescription on chain and waits for the receipt.
   *
   * Rejects with whatever the transport threw; `issueRejectionFor` translates
   * the contract's custom errors into the doctor's rejection vocabulary.
   */
  issue(request: IssueRequest): Promise<IssueReceipt>;

  getPrescription(contentHash: Bytes32): Promise<PrescriptionRecord>;

  /** Every `PrescriptionIssued` event whose indexed `prescriber` is this account. */
  issuedBy(prescriber: Address): Promise<IssuedPrescriptionLog[]>;
}

/** The RPC endpoint did not answer. Distinct from a verdict about the receta. */
export class ChainUnreachableError extends Error {
  constructor(
    readonly rpcUrl: string,
    options?: { cause?: unknown },
  ) {
    super(`No hay respuesta del nodo en ${rpcUrl}.`, options);
    this.name = 'ChainUnreachableError';
  }
}
