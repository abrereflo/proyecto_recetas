import { saltToHex } from '@recetas/crypto';
import {
  prescriptionDocumentSchema,
  type PrescriptionDocument,
  type PrescriptionItem,
} from '@recetas/shared';
import { midnightInDays, secondsToIso } from './format';

/**
 * Builds the plaintext clinical document.
 *
 * Defaults are a realistic Bolivian acute prescription: an antibiotic plus an
 * antipyretic, prescribed by active ingredient and ATC code, with no commercial
 * product (D-07, docs/03-modelo-de-datos.md).
 *
 * This object is the one thing that must never leave the client in the clear.
 */

const DEFAULT_PATIENT = {
  patientId: 'CI 6754321 LP',
  fullName: 'María Elena Quispe Mamani',
  birthDate: '1987-03-14',
} as const;

const DEFAULT_PRACTITIONER = {
  licenseNumber: 'MSP-14523',
  fullName: 'Dra. Claudia Mendoza Rojas',
} as const;

const DEFAULT_ITEMS: PrescriptionItem[] = [
  {
    atcCode: 'J01CA04',
    activeIngredient: 'amoxicilina',
    strength: '500 mg',
    doseForm: 'cápsula',
    quantity: 21,
    dosageInstruction: '1 cápsula cada 8 horas durante 7 días',
  },
  {
    atcCode: 'N02BE01',
    activeIngredient: 'paracetamol',
    strength: '500 mg',
    doseForm: 'tableta',
    quantity: 12,
    dosageInstruction: '1 tableta cada 8 horas si hay fiebre, máximo 3 días',
  },
];

/** Default validity window, in days. */
export const DEFAULT_VALIDITY_DAYS = 30;

export interface DraftOptions {
  patientName?: string | undefined;
  patientId?: string | undefined;
  birthDate?: string | undefined;
  /** Repeatable `--items` values. */
  items?: string[] | undefined;
  validityDays?: number | undefined;
}

/**
 * Parses `atc:ingredient:strength:doseForm:quantity:instruction`.
 *
 * The instruction is the tail of the line, so it may contain colons; the first
 * five fields may not.
 */
export function parseItem(raw: string): PrescriptionItem {
  const parts = raw.split(':');
  if (parts.length < 6) {
    throw new Error(
      `Formato de ítem inválido: "${raw}". Se espera ` +
        'atc:principio:concentración:forma:cantidad:posología',
    );
  }

  const [atcCode, activeIngredient, strength, doseForm, quantityRaw, ...rest] = parts as [
    string,
    string,
    string,
    string,
    string,
    ...string[],
  ];

  const quantity = Number(quantityRaw);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(`La cantidad del ítem debe ser un entero positivo, se recibió "${quantityRaw}"`);
  }

  return {
    atcCode: atcCode.trim(),
    activeIngredient: activeIngredient.trim(),
    strength: strength.trim(),
    doseForm: doseForm.trim(),
    quantity,
    dosageInstruction: rest.join(':').trim(),
  };
}

export interface DraftResult {
  document: PrescriptionDocument;
  /** Same instant as `document.expiresAt`, as the uint64 the contract stores. */
  expiresAtSeconds: bigint;
}

/**
 * Assembles and validates the plaintext document.
 *
 * `salt` is a fresh 32-byte value per prescription: a stable salt would let any
 * chain observer group a patient's prescriptions (hard rule, docs/03). It lives
 * inside the encrypted document and in the off-chain store, never in the QR.
 */
export function buildDraft(salt: Uint8Array, options: DraftOptions = {}): DraftResult {
  const issuedAt = new Date();
  const expiresAtSeconds = midnightInDays(options.validityDays ?? DEFAULT_VALIDITY_DAYS, issuedAt);

  const items =
    options.items === undefined || options.items.length === 0
      ? DEFAULT_ITEMS
      : options.items.map(parseItem);

  const document: PrescriptionDocument = {
    patient: {
      patientId: options.patientId ?? DEFAULT_PATIENT.patientId,
      fullName: options.patientName ?? DEFAULT_PATIENT.fullName,
      birthDate: options.birthDate ?? DEFAULT_PATIENT.birthDate,
    },
    salt: saltToHex(salt),
    practitioner: { ...DEFAULT_PRACTITIONER },
    items,
    issuedAt: issuedAt.toISOString(),
    expiresAt: secondsToIso(expiresAtSeconds),
  };

  // Validate against the shared schema, but keep the branded literal types.
  prescriptionDocumentSchema.parse(document);

  return { document, expiresAtSeconds };
}
