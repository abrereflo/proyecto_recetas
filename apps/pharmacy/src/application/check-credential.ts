import type { Address, Bytes32 } from '@recetas/shared';
import type { RejectionReason } from '../domain/rejection';
import { ChainUnreachableError, type ChainPort } from '../ports/chain.port';

/**
 * Screen P1: the credential is checked BEFORE the scanner is enabled (docs/17).
 *
 * `credentialOf` returns a POINTER, never a verdict: the registry re-reads and
 * re-validates the EAS attestation on every `dispense`, so a credential revoked
 * after registration cuts access on the next call (docs/04). A zero uid here
 * means this account never pointed itself at a credential at all.
 *
 * HARD RULE (docs/07, docs/17): revocation revokes FUTURE access. Nothing
 * already registered is deleted, and the copy in domain/rejection.ts says so.
 */

/** The uid `credentialOf` returns for an account that registered none. */
export const ZERO_UID = '0x0000000000000000000000000000000000000000000000000000000000000000';

export interface CheckCredentialDeps {
  chain: ChainPort;
}

export interface CheckCredentialInput {
  account: Address;
}

export type CredentialStatus =
  | { accredited: true; account: Address; uid: Bytes32 }
  | { accredited: false; account: Address; reason: RejectionReason };

export type CheckCredential = (input: CheckCredentialInput) => Promise<CredentialStatus>;

export function createCheckCredential(deps: CheckCredentialDeps): CheckCredential {
  const { chain } = deps;

  return async ({ account }) => {
    let uid: Bytes32;
    try {
      uid = await chain.credentialOf(account);
    } catch (error) {
      return {
        accredited: false,
        account,
        reason: {
          code: 'network-error',
          message:
            error instanceof ChainUnreachableError
              ? 'No se pudo comprobar la credencial de la farmacia en la cadena.'
              : 'La consulta a la cadena no se pudo completar.',
        },
      };
    }

    if (uid.toLowerCase() === ZERO_UID) {
      return {
        accredited: false,
        account,
        reason: { code: 'pharmacy-credential-revoked', account },
      };
    }

    // A registered pointer is not proof of vigency: the attestation could have
    // been revoked since. The contract re-validates it on `dispense`, and that
    // revert lands on the same `pharmacy-credential-revoked` reason.
    return { accredited: true, account, uid };
  };
}
