import type { Address, Bytes32 } from '@recetas/shared';
import type { IssueRejection } from '../domain/issuance';
import { ChainUnreachableError, type ChainPort } from '../ports/chain.port';

/**
 * Screen D1: the medical credential is checked BEFORE the prescription form is
 * enabled, exactly as the pharmacy checks its own before enabling the scanner
 * (docs/17).
 *
 * `credentialOf` returns a POINTER, never a verdict: the registry re-reads and
 * re-validates the EAS attestation on every `issue`, so a credential revoked
 * after registration cuts access on the next call (docs/04). A zero uid here
 * means this account never pointed itself at a credential at all.
 *
 * HARD RULE (docs/07, docs/17): revocation revokes FUTURE access. Nothing
 * already anchored is deleted, and the copy in domain/issuance.ts says so.
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
  | { accredited: false; account: Address; reason: IssueRejection };

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
              ? 'No se pudo comprobar la credencial médica en la cadena.'
              : 'La consulta a la cadena no se pudo completar.',
        },
      };
    }

    if (uid.toLowerCase() === ZERO_UID) {
      return {
        accredited: false,
        account,
        reason: { code: 'practitioner-credential-missing', account },
      };
    }

    // A registered pointer is not proof of vigency: the attestation could have
    // been revoked since. The contract re-validates it on `issue`, and that
    // revert lands on the same `practitioner-credential-missing` reason.
    return { accredited: true, account, uid };
  };
}
