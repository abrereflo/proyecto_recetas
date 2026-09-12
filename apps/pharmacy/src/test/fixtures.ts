import {
  PrescriptionStatus,
  type Address,
  type Bytes32,
  type PrescriptionDocument,
  type PrescriptionRecord,
  type QrPayload,
  type VerificationResult,
} from '@recetas/shared';
import type { DocumentEvidence, VerificationEvidence } from '../domain/verification';

/**
 * Deterministic fixtures for the verification tests.
 *
 * Every value is invented. HARD RULE (docs/08): no real patient data lives
 * anywhere in this repository, tests included.
 */

export const PRESCRIBER = '0x1111111111111111111111111111111111111111' as Address;
export const OTHER_SIGNER = '0x2222222222222222222222222222222222222222' as Address;
export const PHARMACY_A = '0x51aE0000000000000000000000000000000f8837' as Address;
export const PHARMACY_B = '0x9999999999999999999999999999999999999999' as Address;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

export const CONTENT_HASH =
  '0x9f2c41ab7d5e8036c4b1a90f7e3d2c5b8a4610fd93e7c2b5a8d1f04e63c9b7a2' as Bytes32;
export const TAMPERED_CONTENT_HASH =
  '0xdeadbeef0000000000000000000000000000000000000000000000000000beef' as Bytes32;
export const PATIENT_COMMITMENT =
  '0x3333333333333333333333333333333333333333333333333333333333333333' as Bytes32;
export const OTHER_COMMITMENT =
  '0x4444444444444444444444444444444444444444444444444444444444444444' as Bytes32;
export const SALT = '0x5555555555555555555555555555555555555555555555555555555555555555' as Bytes32;
export const CREDENTIAL_UID =
  '0x6666666666666666666666666666666666666666666666666666666666666666' as Bytes32;
export const ZERO_UID =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as Bytes32;

export const REGISTRY_ADDRESS = '0x7777777777777777777777777777777777777777' as Address;
export const CHAIN_ID = 31337;

/** 2026-09-11T13:41:00Z. */
export const ISSUED_AT = 1_789_134_060n;
/** 2026-10-11T04:00:00Z, midnight of the expiry day in Bolivia (D-13). */
export const EXPIRES_AT = 1_791_691_200n;
/** Comfortably inside the validity window. */
export const BLOCK_TIME = 1_789_134_400n;
/** 2026-09-11T13:42:00Z, one minute after issue. */
export const DISPENSED_AT = 1_789_134_120n;

export function aDocument(overrides: Partial<PrescriptionDocument> = {}): PrescriptionDocument {
  return {
    patient: {
      patientId: 'CI-0000000',
      fullName: 'Paciente de Prueba',
      birthDate: '1990-01-01',
    },
    salt: SALT,
    practitioner: { licenseNumber: 'MED-0000-XX', fullName: 'Dra. Prueba' },
    items: [
      {
        atcCode: 'J01CA04',
        activeIngredient: 'amoxicilina',
        strength: '500 mg',
        doseForm: 'cápsula',
        quantity: 21,
        dosageInstruction: '1 cada 8 horas por 7 días',
      },
    ],
    issuedAt: '2026-09-11T13:41:00.000Z',
    expiresAt: '2026-10-11T04:00:00.000Z',
    ...overrides,
  };
}

export function aRecord(overrides: Partial<PrescriptionRecord> = {}): PrescriptionRecord {
  return {
    prescriber: PRESCRIBER,
    patientCommitment: PATIENT_COMMITMENT,
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    dispensedBy: ZERO_ADDRESS,
    dispensedAt: 0n,
    status: PrescriptionStatus.Issued,
    ...overrides,
  };
}

export function aChainState(overrides: Partial<VerificationResult> = {}): VerificationResult {
  return {
    status: PrescriptionStatus.Issued,
    dispensable: true,
    prescriber: PRESCRIBER,
    expiresAt: EXPIRES_AT,
    ...overrides,
  };
}

export function aDocumentEvidence(overrides: Partial<DocumentEvidence> = {}): DocumentEvidence {
  return {
    document: aDocument(),
    storedContentHash: CONTENT_HASH,
    anchoredContentHash: CONTENT_HASH,
    signer: PRESCRIBER,
    signatureValid: true,
    recomputedPatientCommitment: PATIENT_COMMITMENT,
    ...overrides,
  };
}

export function anEvidence(overrides: Partial<VerificationEvidence> = {}): VerificationEvidence {
  return {
    referenceTimestamp: BLOCK_TIME,
    chain: aChainState(),
    record: aRecord(),
    document: aDocumentEvidence(),
    ...overrides,
  };
}

export function aQrPayload(overrides: Partial<QrPayload> = {}): QrPayload {
  return {
    v: 1,
    chainId: CHAIN_ID,
    registry: REGISTRY_ADDRESS,
    contentHash: CONTENT_HASH,
    pointer: 'AAAAAAAAAAAAAAAAAAAAAA',
    key: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    ...overrides,
  };
}
