import { verifyTypedData, type Address, type Hex } from 'viem';
import {
  PRESCRIPTION_EIP712_TYPES,
  PRESCRIPTION_PRIMARY_TYPE,
  prescriptionDomain,
} from '@recetas/shared';

/**
 * Prescriber signature, EIP-712: the viem-facing half.
 *
 * @recetas/shared already owns the domain name, the version and the type
 * definition, and must keep owning them: it depends only on zod, so a consumer
 * that never touches a chain can still hash and validate a document. What lives
 * here is only what needs viem — building the concrete typed-data domain for a
 * deployment, and recovering a signer from a signature.
 *
 * Signing is deliberately NOT here. The CLI signs with a `LocalAccount` private
 * key and the doctor app will sign through a wallet client; those are different
 * mechanisms with different failure modes, and pretending they are one function
 * would only produce a wrapper with two unrelated branches.
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

/** Everything the domain separator needs, and nothing else. */
export interface RegistryDeployment {
  chainId: number;
  registryAddress: Address;
}

export interface PrescriptionTypedDataDomain {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
}

/** The domain separator of one concrete deployment. */
export function domainFor(deployment: RegistryDeployment): PrescriptionTypedDataDomain {
  const domain = prescriptionDomain(deployment.registryAddress, deployment.chainId);

  return {
    name: domain.name,
    version: domain.version,
    chainId: domain.chainId,
    verifyingContract: domain.verifyingContract as Address,
  };
}

/** Completes a message with the MVP nonce, so no caller has to remember it. */
export function buildMessage(input: Omit<PrescriptionMessage, 'nonce'>): PrescriptionMessage {
  return { ...input, nonce: MVP_NONCE };
}

/**
 * Offline EIP-712 recovery. No network call is involved for an EOA signature.
 *
 * This propagates whatever viem throws for a malformed signature: whether that
 * is "invalid" or "broken" is the caller's call to make, and the pharmacy and
 * the CLI answer it differently.
 *
 * TODO (docs/01): once prescribers move to ERC-4337 smart accounts this needs
 * the ERC-1271 `isValidSignature` path, which does require a public client.
 */
export async function verifyPrescriptionSignature(input: {
  deployment: RegistryDeployment;
  signer: Address;
  message: PrescriptionMessage;
  signature: Hex;
}): Promise<boolean> {
  return verifyTypedData({
    address: input.signer,
    domain: domainFor(input.deployment),
    types: PRESCRIPTION_EIP712_TYPES,
    primaryType: PRESCRIPTION_PRIMARY_TYPE,
    message: input.message,
    signature: input.signature,
  });
}
