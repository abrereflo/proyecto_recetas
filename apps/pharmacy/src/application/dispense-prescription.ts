import type { Address, Bytes32 } from '@recetas/shared';
import type { RejectionReason } from '../domain/rejection';
import { ChainUnreachableError, type ChainPort, type DispenseReceipt } from '../ports/chain.port';
import { SignerRejectedError } from '../ports/signer.port';
import { decodeRegistryRejection } from '../infrastructure/chain/registry-errors';

/**
 * Screen P4 to P5: registering the dispensation.
 *
 * HARD RULE (docs/17): confirming the delivery is a deliberate human act, not a
 * side effect of scanning. That is why this is its own use case and why nothing
 * in verify-prescription.ts calls it. Firing something irreversible from a
 * passive gesture — pointing a camera at a QR — is a design error, not a flow
 * optimisation.
 *
 * HARD RULE (docs/04, docs/17): the transition to `Dispensed` is irreversible.
 * There is no reopen, no undo and no cancel-dispensation operation anywhere in
 * this module, because the contract has none.
 */

export interface DispensePrescriptionDeps {
  chain: ChainPort;
}

export interface DispensePrescriptionInput {
  contentHash: Bytes32;
  /** The account that will be recorded as `dispensedBy`. */
  pharmacy: Address;
  /**
   * `expiresAt` as the chain reported it during verification. Used to refuse
   * locally before any gas is spent; see the expiry note below.
   */
  expiresAt: bigint;
}

export type DispensePrescriptionResult =
  | { outcome: 'dispensed'; receipt: DispenseReceipt }
  | { outcome: 'rejected'; reason: RejectionReason }
  /** The person declined the confirmation prompt. Not a rejection, a decision. */
  | { outcome: 'aborted' };

export type DispensePrescription = (
  input: DispensePrescriptionInput,
) => Promise<DispensePrescriptionResult>;

export function createDispensePrescription(
  deps: DispensePrescriptionDeps,
): DispensePrescription {
  const { chain } = deps;

  return async ({ contentHash, pharmacy, expiresAt }) => {
    // Expiry is CLIENT-DERIVED: `Expired` is not a value of the on-chain enum
    // (docs/04, docs/17). Deriving it here, against BLOCK time and never the
    // device clock, means no gas is burnt on a transaction the contract would
    // refuse anyway.
    let referenceTimestamp: bigint;
    try {
      referenceTimestamp = await chain.blockTimestamp();
    } catch (error) {
      return {
        outcome: 'rejected',
        reason: {
          code: 'network-error',
          message:
            error instanceof ChainUnreachableError
              ? 'No se pudo consultar la hora de la cadena antes de registrar la entrega.'
              : 'La consulta a la cadena no se pudo completar.',
        },
      };
    }

    if (referenceTimestamp >= expiresAt) {
      return { outcome: 'rejected', reason: { code: 'expired', expiresAt } };
    }

    try {
      const receipt = await chain.dispense(contentHash, pharmacy);
      return { outcome: 'dispensed', receipt };
    } catch (error) {
      if (error instanceof SignerRejectedError) {
        return { outcome: 'aborted' };
      }

      // The contract is the authority on why. `AlreadyDispensed` carries who
      // and when, `NotAccreditedPharmacy` carries the account, and
      // `PrescriptionExpired` is the fallback for the clock/block race the
      // guard above cannot close: both expiry paths land on the same reason.
      const rejection = decodeRegistryRejection(error);
      if (rejection !== undefined) {
        return { outcome: 'rejected', reason: rejection };
      }

      if (error instanceof ChainUnreachableError) {
        return {
          outcome: 'rejected',
          reason: {
            code: 'network-error',
            message: 'No hay respuesta de la cadena, así que la entrega no quedó registrada.',
          },
        };
      }

      // An error nobody modelled must not be dressed up as a verdict for the
      // counter. Let it surface (docs/17: never a generic "operación fallida").
      throw error;
    }
  };
}
