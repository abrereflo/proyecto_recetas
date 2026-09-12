import type {
  Address,
  Bytes32,
  Hex,
  PrescriptionRecord,
  VerificationResult,
} from '@recetas/shared';

/**
 * Everything the pharmacy needs from `PrescriptionRegistry`, as an interface.
 *
 * Reads are free and happen first; the single write is the irreversible act of
 * dispensing (docs/04, docs/17 P4). There is deliberately NO reopen, undo or
 * cancel-dispensation operation here, because the contract has none and an
 * interface that suggested one would lie about the only property that sustains
 * the project.
 */

/** What screen P5 prints as the on-chain receipt. */
export interface DispenseReceipt {
  transactionHash: Hex;
  blockNumber: bigint;
  /** Unix seconds of the block that mined the dispensation. */
  blockTimestamp: bigint;
  /** The pharmacy account the chain recorded. */
  dispensedBy: Address;
}

export interface ChainPort {
  /**
   * Latest block timestamp, Unix seconds.
   *
   * Expiry is derived against this value, never against the device clock
   * (docs/17): a phone with a skewed clock must not disagree with the contract.
   */
  blockTimestamp(): Promise<bigint>;

  verify(contentHash: Bytes32): Promise<VerificationResult>;

  getPrescription(contentHash: Bytes32): Promise<PrescriptionRecord>;

  /** EAS uid this account registered, or the zero uid when it registered none. */
  credentialOf(account: Address): Promise<Bytes32>;

  /**
   * Registers the dispensation on chain and waits for the receipt.
   *
   * Rejects with whatever the transport threw; `decodeRegistryRejection`
   * translates the contract's custom errors into domain rejection codes.
   */
  dispense(contentHash: Bytes32, pharmacy: Address): Promise<DispenseReceipt>;
}

/** The RPC endpoint did not answer. Distinct from a verdict about the receta. */
export class ChainUnreachableError extends Error {
  constructor(readonly rpcUrl: string, options?: { cause?: unknown }) {
    super(`No hay respuesta del nodo en ${rpcUrl}.`, options);
    this.name = 'ChainUnreachableError';
  }
}
