/**
 * EIP-712 typed data for the prescriber signature.
 *
 * The doctor UI renders these fields as readable sentences, never as raw hex
 * (docs/17-diseno-y-experiencia.md, screen D5).
 */

/** Base Sepolia. */
export const BASE_SEPOLIA_CHAIN_ID = 84532 as const;

export const EIP712_DOMAIN_NAME = 'RecetaVerificable' as const;
export const EIP712_DOMAIN_VERSION = '1' as const;

export interface Eip712Domain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract?: string;
}

/**
 * Domain separator for the integration network.
 *
 * `verifyingContract` is added at runtime once PrescriptionRegistry is deployed;
 * use `prescriptionDomain()` rather than this constant when signing.
 */
export const PRESCRIPTION_EIP712_DOMAIN = {
  name: EIP712_DOMAIN_NAME,
  version: EIP712_DOMAIN_VERSION,
  chainId: BASE_SEPOLIA_CHAIN_ID,
} as const satisfies Eip712Domain;

/** Build the domain for a concrete deployment. */
export function prescriptionDomain(
  verifyingContract: string,
  chainId: number = BASE_SEPOLIA_CHAIN_ID,
): Eip712Domain {
  return {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  };
}

/**
 * Typed data definition. Field order is part of the type hash: do not reorder.
 *
 * No patient identifier appears here, by the hard rule of
 * docs/03-modelo-de-datos.md: only the salted commitment.
 */
export const PRESCRIPTION_EIP712_TYPES = {
  Prescription: [
    { name: 'contentHash', type: 'bytes32' },
    { name: 'patientCommitment', type: 'bytes32' },
    { name: 'prescriber', type: 'address' },
    { name: 'issuedAt', type: 'uint64' },
    { name: 'expiresAt', type: 'uint64' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

export const PRESCRIPTION_PRIMARY_TYPE = 'Prescription' as const;

/** The signed message. */
export interface Prescription {
  contentHash: string;
  patientCommitment: string;
  prescriber: string;
  issuedAt: bigint;
  expiresAt: bigint;
  /** Replay protection per prescriber. */
  nonce: bigint;
}
