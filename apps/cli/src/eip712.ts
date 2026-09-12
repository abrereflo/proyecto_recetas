import { verifyTypedData, type Address, type Hex, type LocalAccount } from 'viem';
import {
  PRESCRIPTION_EIP712_TYPES,
  PRESCRIPTION_PRIMARY_TYPE,
  prescriptionDomain,
} from '@recetas/shared';
import type { CliConfig } from './config';

/**
 * Prescriber signature, EIP-712.
 *
 * The domain and the type definition come from @recetas/shared so the CLI, the
 * doctor SPA and the pharmacy PWA sign and verify exactly the same structure.
 *
 * The message carries no patient identifier, only the salted commitment (hard
 * rule, docs/03-modelo-de-datos.md).
 */

/**
 * Replay protection nonce.
 *
 * Fixed at 0 for the MVP: the registry does not track per-prescriber nonces,
 * and replaying an identical document is already impossible because `issue`
 * reverts with `AlreadyIssued` on a repeated `contentHash`. The field stays in
 * the type so adding a real nonce later does not change the type hash callers
 * already signed against.
 */
export const MVP_NONCE = 0n;

export interface PrescriptionMessage {
  contentHash: Hex;
  patientCommitment: Hex;
  prescriber: Address;
  issuedAt: bigint;
  expiresAt: bigint;
  nonce: bigint;
}

export function domainFor(config: CliConfig): {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
} {
  const domain = prescriptionDomain(config.registryAddress, config.chainId);

  return {
    name: domain.name,
    version: domain.version,
    chainId: domain.chainId,
    verifyingContract: domain.verifyingContract as Address,
  };
}

export function buildMessage(input: {
  contentHash: Hex;
  patientCommitment: Hex;
  prescriber: Address;
  issuedAt: bigint;
  expiresAt: bigint;
}): PrescriptionMessage {
  return { ...input, nonce: MVP_NONCE };
}

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
  return verifyTypedData({
    address: signer,
    domain: domainFor(config),
    types: PRESCRIPTION_EIP712_TYPES,
    primaryType: PRESCRIPTION_PRIMARY_TYPE,
    message,
    signature,
  });
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
