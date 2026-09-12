import type { Address, Hex, LocalAccount } from 'viem';
import { PRESCRIPTION_EIP712_TYPES, PRESCRIPTION_PRIMARY_TYPE } from '@recetas/shared';
import {
  domainFor,
  verifyPrescriptionSignature,
  type PrescriptionMessage,
} from '@recetas/chain';
import type { CliConfig } from './config';

/**
 * Prescriber signature, EIP-712.
 *
 * The domain, the type definition, the fixed MVP nonce and the verifier come
 * from @recetas/chain over @recetas/shared, so the CLI, the doctor SPA and the
 * pharmacy PWA sign and verify exactly the same structure.
 *
 * Signing stays here: this is the only consumer that holds a raw private key
 * and signs through a `LocalAccount`. The doctor app will sign through a wallet
 * client, which is a different mechanism.
 *
 * The message carries no patient identifier, only the salted commitment (hard
 * rule, docs/03-modelo-de-datos.md).
 */

export { MVP_NONCE, buildMessage, domainFor } from '@recetas/chain';
export type { PrescriptionMessage } from '@recetas/chain';

export async function signPrescription(
  account: LocalAccount,
  config: CliConfig,
  message: PrescriptionMessage,
): Promise<Hex> {
  return account.signTypedData({
    domain: domainFor(config),
    types: PRESCRIPTION_EIP712_TYPES,
    primaryType: PRESCRIPTION_PRIMARY_TYPE,
    message,
  });
}

export async function isSignatureValid(
  config: CliConfig,
  signer: Address,
  message: PrescriptionMessage,
  signature: Hex,
): Promise<boolean> {
  return verifyPrescriptionSignature({ deployment: config, signer, message, signature });
}

/** Human-readable rendering of the typed data, as screen D5 requires. */
export function describeMessage(message: PrescriptionMessage): string[] {
  return [
    `Huella del contenido: ${message.contentHash}`,
    `Compromiso del paciente: ${message.patientCommitment}`,
    `Prescriptor: ${message.prescriber}`,
    `Emitida (unix): ${message.issuedAt}`,
    `Vence (unix): ${message.expiresAt}`,
  ];
}
