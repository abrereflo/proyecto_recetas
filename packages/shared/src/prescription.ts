import { z } from 'zod';

/**
 * On-chain lifecycle status.
 *
 * Numeric values MUST stay aligned with the Solidity enum in
 * contracts/src/PrescriptionRegistry.sol.
 *
 * `Expired` is deliberately absent: it is not a stored state, it is a condition
 * derived by comparing `expiresAt` with block time on the client
 * (docs/04-smart-contracts.md, docs/17-diseno-y-experiencia.md).
 */
export enum PrescriptionStatus {
  None = 0,
  Issued = 1,
  Dispensed = 2,
  Cancelled = 3,
}

export const prescriptionStatusSchema = z.nativeEnum(PrescriptionStatus);

/** Hex string, `0x`-prefixed. */
export const hexSchema = z.string().regex(/^0x[0-9a-fA-F]*$/, 'expected 0x-prefixed hex');
/** 32-byte hex value (keccak256 output, commitment, salt). */
export const bytes32Schema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/, 'expected 0x-prefixed 32-byte hex');
/** EVM address. */
export const addressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'expected 0x-prefixed 20-byte address');

export type Hex = `0x${string}`;
export type Bytes32 = `0x${string}`;
export type Address = `0x${string}`;

/**
 * One prescribed medication line. Field names come verbatim from the
 * PRESCRIPTION_ITEM entity in docs/03-modelo-de-datos.md.
 *
 * There is no commercial product field: the MVP prescribes by active ingredient
 * and ATC code only (D-07).
 */
export interface PrescriptionItem {
  /** WHO ATC classification code, e.g. "J01CA04". */
  atcCode: string;
  /** International non-proprietary name, e.g. "amoxicillin". */
  activeIngredient: string;
  /** e.g. "500 mg". */
  strength: string;
  /** e.g. "capsule". */
  doseForm: string;
  quantity: number;
  /** e.g. "1 capsule every 8 hours for 7 days". */
  dosageInstruction: string;
}

export const prescriptionItemSchema = z.object({
  atcCode: z.string().min(1),
  activeIngredient: z.string().min(1),
  strength: z.string().min(1),
  doseForm: z.string().min(1),
  quantity: z.number().int().positive(),
  dosageInstruction: z.string().min(1),
});

/** Patient block of the plaintext document. Never on-chain. */
export interface PrescriptionPatient {
  patientId: string;
  fullName: string;
  birthDate: string;
}

export const prescriptionPatientSchema = z.object({
  patientId: z.string().min(1),
  fullName: z.string().min(1),
  birthDate: z.string().min(1),
});

/** Practitioner block of the plaintext document. Never on-chain. */
export interface PrescriptionPractitioner {
  licenseNumber: string;
  fullName: string;
}

export const prescriptionPractitionerSchema = z.object({
  licenseNumber: z.string().min(1),
  fullName: z.string().min(1),
});

/**
 * The plaintext prescription document, exactly as it looks once decrypted
 * (docs/03-modelo-de-datos.md). This object NEVER leaves the client unencrypted.
 *
 * `salt` is the per-prescription random value behind `patientCommitment`. It
 * lives only in the encrypted store; it must never reach the chain, the QR, a
 * URL or a log line (docs/17-diseno-y-experiencia.md).
 */
export interface PrescriptionDocument {
  patient: PrescriptionPatient;
  salt: Bytes32;
  practitioner: PrescriptionPractitioner;
  items: PrescriptionItem[];
  /** ISO 8601 timestamp. */
  issuedAt: string;
  /** ISO 8601 timestamp. Midnight of the expiry day (D-13). */
  expiresAt: string;
}

export const prescriptionDocumentSchema = z.object({
  patient: prescriptionPatientSchema,
  salt: bytes32Schema,
  practitioner: prescriptionPractitionerSchema,
  items: z.array(prescriptionItemSchema).min(1),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});

/**
 * The on-chain record, mirroring `PrescriptionRecord` in Solidity.
 * Timestamps are Unix seconds.
 */
export interface PrescriptionRecord {
  prescriber: Address;
  patientCommitment: Bytes32;
  issuedAt: bigint;
  expiresAt: bigint;
  dispensedBy: Address;
  dispensedAt: bigint;
  status: PrescriptionStatus;
}

/** Return shape of `PrescriptionRegistry.verify`. */
export interface VerificationResult {
  status: PrescriptionStatus;
  dispensable: boolean;
  prescriber: Address;
  expiresAt: bigint;
}
