import { EMPTY_PATIENT_CONTEXT } from '@recetas/rules';
import {
  PrescriptionStatus,
  type Address,
  type Bytes32,
  type EncryptedDocument,
  type Hex,
  type PrescriptionItem,
  type PrescriptionRecord,
} from '@recetas/shared';
import { DEFAULT_VALIDITY_DAYS, type PrescriptionDraft } from '../domain/draft';
import type { IssuedPrescriptionLog } from '../ports/chain.port';
import type { DoctorConfig } from '../infrastructure/config/env';

/**
 * Deterministic fixtures for the doctor tests.
 *
 * Every value is invented. HARD RULE (docs/08): no real patient data lives
 * anywhere in this repository, tests included.
 */

export const PRESCRIBER = '0x1111111111111111111111111111111111111111' as Address;
export const PHARMACY = '0x51aE0000000000000000000000000000000f8837' as Address;
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
export const REGISTRY_ADDRESS = '0x7777777777777777777777777777777777777777' as Address;
export const CHAIN_ID = 31337;

export const CONTENT_HASH =
  '0x9f2c41ab7d5e8036c4b1a90f7e3d2c5b8a4610fd93e7c2b5a8d1f04e63c9b7a2' as Bytes32;
export const PATIENT_COMMITMENT =
  '0x3333333333333333333333333333333333333333333333333333333333333333' as Bytes32;
export const CREDENTIAL_UID =
  '0x6666666666666666666666666666666666666666666666666666666666666666' as Bytes32;
export const ZERO_UID =
  '0x0000000000000000000000000000000000000000000000000000000000000000' as Bytes32;
export const TRANSACTION_HASH =
  '0xabc0000000000000000000000000000000000000000000000000000000000001' as Hex;
export const SIGNATURE = `0x${'ab'.repeat(65)}` as Hex;

/** 2026-09-11T13:41:00Z. */
export const ISSUED_AT = 1_789_134_060n;
export const ISSUED_AT_DATE = new Date('2026-09-11T13:41:00.000Z');
/** 2026-10-11T04:00:00Z: midnight of the expiry day in Bolivia (D-13). */
export const EXPIRES_AT = 1_791_691_200n;
/** Comfortably inside the validity window. */
export const BLOCK_TIME = 1_789_134_400n;
/** 2026-09-11T13:42:00Z, one minute after the issuance. */
export const DISPENSED_AT = 1_789_134_120n;

/** A salt of known bytes, so a test can assert it never leaves the client. */
export const SALT_BYTES = new Uint8Array(32).fill(0xa5);
/** A DEK of known bytes, so a test can assert what the QR carries. */
export const DEK_BYTES = new Uint8Array(32).fill(0x5a);

export const CONFIG: DoctorConfig = {
  apiUrl: 'http://localhost:3000',
  rpcUrl: 'http://localhost:8545',
  chainId: CHAIN_ID,
  registryAddress: REGISTRY_ADDRESS,
};

export const POINTER = 'AAAAAAAAAAAAAAAAAAAAAA';

export function anItem(overrides: Partial<PrescriptionItem> = {}): PrescriptionItem {
  return {
    atcCode: 'J01CA04',
    activeIngredient: 'amoxicilina',
    strength: '500 mg',
    doseForm: 'cápsula',
    quantity: 21,
    dosageInstruction: '1 cápsula cada 8 horas durante 7 días',
    ...overrides,
  };
}

export function aDraft(overrides: Partial<PrescriptionDraft> = {}): PrescriptionDraft {
  return {
    patient: {
      patientId: 'CI-0000000',
      fullName: 'Paciente de Prueba',
      birthDate: '1990-01-01',
    },
    practitioner: { licenseNumber: 'MED-0000-XX', fullName: 'Dra. Prueba' },
    items: [anItem()],
    patientContext: { ...EMPTY_PATIENT_CONTEXT },
    validityDays: DEFAULT_VALIDITY_DAYS,
    justifications: [],
    ...overrides,
  };
}

/** A sealed envelope with the shape the store accepts. Bytes are invented. */
export function anEnvelope(overrides: Partial<EncryptedDocument> = {}): EncryptedDocument {
  return {
    schemaVersion: '1.0.0',
    documentType: 'Prescription',
    createdAt: '2026-09-11T13:41:00.000Z',
    encryption: {
      algorithm: 'AES-256-GCM',
      iv: 'AAAAAAAAAAAAAAAA',
      authTag: 'AAAAAAAAAAAAAAAAAAAAAA==',
    },
    signatures: {
      eip712: { signer: PRESCRIBER, value: SIGNATURE },
      adsib: { certificateSerial: '', value: '', status: 'pending-integration' },
    },
    ciphertext: 'AAAAAAAA',
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

export function aLog(overrides: Partial<IssuedPrescriptionLog> = {}): IssuedPrescriptionLog {
  return {
    contentHash: CONTENT_HASH,
    prescriber: PRESCRIBER,
    patientCommitment: PATIENT_COMMITMENT,
    expiresAt: EXPIRES_AT,
    blockNumber: 42n,
    transactionHash: TRANSACTION_HASH,
    ...overrides,
  };
}
