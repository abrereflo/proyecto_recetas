import type { Address, Bytes32, Hex, QrPayload } from '@recetas/shared';
import type { DraftIssue } from './draft';

/**
 * The issuing sequence, described rather than executed (screens D5 and D6).
 *
 * The order is the one apps/cli follows step by step, which is itself the
 * "emitir" sequence of docs/05-almacenamiento-y-cifrado.md. This module is
 * pure: it names the steps, types the outcomes and owns the Spanish copy. The
 * execution lives in application/issue-prescription.ts.
 *
 * HARD RULE (docs/06, docs/17 "Ninguna alerta clínica bloquea la emisión"):
 * there is no step here for clearing clinical alerts, and no rejection code for
 * an unacknowledged one. The rules engine is advisory and the pipeline never
 * consults it.
 */

export type IssueStepId =
  /** 1. Assemble and validate the plaintext document. */
  | 'document'
  /** 2. keccak256(patientId, salt). The salt stays off-chain. */
  | 'commitment'
  /** 3. AES-256-GCM in the browser, before anything is signed. */
  | 'seal'
  /** 4. EIP-712 signature of the resulting contentHash (D5). */
  | 'sign'
  /** 5. Store the sealed envelope off-chain. */
  | 'store'
  /** 6. Anchor the contentHash on-chain. */
  | 'anchor'
  /** 7. Build the QR the patient carries (D6). */
  | 'qr';

export interface IssueStep {
  id: IssueStepId;
  /** Shown as a readable sentence on D5, never as a hexadecimal (docs/17). */
  label: string;
}

/**
 * THE ORDER IS THE CONTRACT, not a presentation detail.
 *
 * `store` comes before `anchor`, exactly as in apps/cli/src/commands/issue.ts.
 * If the chain write fails after the store succeeded, the stored ciphertext is
 * orphaned and harmless: with no anchor, no prescription exists, and nothing
 * can be verified or dispensed against it.
 *
 * Reversing the two produces the failure that matters: an anchored prescription
 * pointing at a pointer that was never stored — a receta that verifies on chain
 * and cannot be read at the counter, with no way to repair it, because
 * `contentHash` is already taken and `AlreadyIssued` refuses a second attempt.
 */
export const ISSUE_STEPS: readonly IssueStep[] = [
  { id: 'document', label: 'Preparando el documento clínico' },
  { id: 'commitment', label: 'Calculando el compromiso del paciente' },
  { id: 'seal', label: 'Cifrando el documento en este equipo' },
  { id: 'sign', label: 'Firmando la receta' },
  { id: 'store', label: 'Guardando el documento cifrado' },
  { id: 'anchor', label: 'Registrando la receta en la cadena' },
  { id: 'qr', label: 'Generando el código para el paciente' },
] as const;

/** Stable machine codes for every way an issuance can be refused. */
export type IssueRejectionCode =
  | 'document-invalid'
  | 'signer-unavailable'
  | 'store-failed'
  | 'already-issued'
  | 'practitioner-credential-missing'
  | 'invalid-expiry'
  | 'transaction-reverted'
  | 'network-error';

/**
 * The refusal, with the evidence the screen needs to say what to do next.
 *
 * One code per situation, one action per code (docs/17, "El rechazo nombra a
 * quién y cuándo, nunca «operación fallida»"). There is deliberately no generic
 * fallback member: a failure nobody modelled surfaces as an exception instead
 * of being dressed up as a verdict about the receta.
 */
export type IssueRejection =
  /** The form does not assemble into a valid clinical document. */
  | { code: 'document-invalid'; issues: DraftIssue[] }
  /** No signing account is configured on this device. */
  | { code: 'signer-unavailable' }
  /** The off-chain store refused or did not answer. NOTHING was anchored. */
  | { code: 'store-failed'; message: string }
  /** `AlreadyIssued`: this exact contentHash is already on chain. */
  | { code: 'already-issued'; contentHash: Bytes32 }
  /** `NotAccreditedPractitioner`: the account holds no valid medical credential. */
  | { code: 'practitioner-credential-missing'; account: Address }
  /** `InvalidExpiry`: the contract refused the expiry instant. */
  | { code: 'invalid-expiry'; expiresAt: bigint }
  /** The anchor was mined with a reverted status: nothing was registered. */
  | { code: 'transaction-reverted'; transactionHash: Hex }
  /** The node or the store did not answer. Not a verdict about the receta. */
  | { code: 'network-error'; message: string };

/** Narrows the union to the member carrying a given code. */
export type IssueRejectionOf<C extends IssueRejectionCode> = Extract<IssueRejection, { code: C }>;

/**
 * The random material of ONE issuing attempt, reusable on a retry.
 *
 * Regenerating it makes a retry a DIFFERENT receta: `contentHash` changes,
 * `AlreadyIssued` can never fire, and a first anchor that was in fact mined is
 * stranded with no QR and no key. The same attempt repeats the same hash — `iv`
 * included, since that hash is keccak256 of the CIPHERTEXT.
 */
export interface IssueAttempt {
  salt: Uint8Array;
  dek: Uint8Array;
  iv: Uint8Array;
  issuedAt: Date;
  /** keccak256 of the plaintext bytes this material sealed. THE REUSE IS BOUND
   * TO THIS VALUE, never to the caller's word: the same `dek` and `iv` over an
   * edited document is an AES-GCM nonce reuse (R1-001). */
  documentHash: Hex;
  /** The hash this attempt sealed. Known once it reached the anchor. */
  contentHash?: Bytes32;
}

/** Outcome of one issuing attempt. */
export type IssueResult =
  | {
      outcome: 'issued';
      /** The encoded QR string, ready to be rendered (D6). */
      qr: string;
      qrPayload: QrPayload;
      contentHash: Bytes32;
      /** Absent when the anchor was recovered from an earlier broadcast. */
      transactionHash?: Hex;
      /** Unix seconds, midnight of the expiry day (D-13). */
      expiresAt: bigint;
    }
  | { outcome: 'rejected'; reason: IssueRejection; attempt?: IssueAttempt }
  /** The prescriber declined the signature. A decision, not a failure. */
  | { outcome: 'aborted' };

/**
 * Presentation helpers injected into the copy so the catalogue stays a pure
 * function of its inputs and the tests stay deterministic.
 */
export interface IssueFormatters {
  /** "11/10/2026". Expiry is a day, not an instant (D-13, docs/17). */
  day(timestamp: bigint): string;
  /** "0x51Ae…8837". Rendered in a monospaced face by the UI (docs/17). */
  address(value: Address): string;
}

/** Bolivia is UTC-4 year round; pinning it keeps every device in agreement. */
const TIME_ZONE = 'America/La_Paz';
const LOCALE = 'es-BO';

export const DEFAULT_ISSUE_FORMATTERS: IssueFormatters = {
  day(timestamp) {
    return new Intl.DateTimeFormat(LOCALE, {
      timeZone: TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(Number(timestamp) * 1000));
  },
  address(value) {
    return value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
  },
};

export interface IssueRejectionCopy<C extends IssueRejectionCode> {
  /** Headline of the refusal. */
  headline: string;
  /** The concrete reason, carrying whatever evidence the code holds. */
  reason: (reason: IssueRejectionOf<C>, format: IssueFormatters) => string;
  /** What the doctor does next. One distinct action per code. */
  action: string;
}

export type IssueRejectionCatalogue = { [C in IssueRejectionCode]: IssueRejectionCopy<C> };

/**
 * Spanish interface copy, neutral professional register (docs/17).
 *
 * HARD RULE (docs/17): the words "wallet", "frase semilla" and "saldo" never
 * appear. Enforced by copy-guard.test.ts over this whole app.
 *
 * HARD RULE (docs/07, docs/17): a credential without vigency revokes FUTURE
 * access. Nothing already registered is deleted, and the copy says so.
 */
export const ISSUE_REJECTION_COPY_ES: IssueRejectionCatalogue = {
  'document-invalid': {
    headline: 'RECETA INCOMPLETA',
    reason: (reason) =>
      reason.issues.length === 1 && reason.issues[0] !== undefined
        ? reason.issues[0].message
        : `La receta tiene ${reason.issues.length} datos por corregir antes de poder emitirse.`,
    action: 'Corrija los campos señalados en el formulario y vuelva a emitir.',
  },

  'signer-unavailable': {
    headline: 'SIN CUENTA MÉDICA',
    reason: () =>
      'Este equipo no tiene configurada la cuenta médica con la que se firman las recetas.',
    action:
      'No es posible firmar ni emitir desde este equipo. Contacte con el responsable técnico ' +
      'de la clínica para habilitar su acceso.',
  },

  'store-failed': {
    headline: 'RECETA NO EMITIDA',
    // The store runs BEFORE the anchor, so this refusal is clean: nothing was
    // registered in the chain and retrying is safe (see ISSUE_STEPS).
    reason: (reason) => reason.message,
    action:
      'La receta no quedó registrada en la cadena y el paciente no tiene ningún código ' +
      'válido. Puede volver a emitirla cuando el almacén responda.',
  },

  'already-issued': {
    headline: 'RECETA YA REGISTRADA',
    reason: () => 'Ya existe en la cadena una receta con esta misma huella de contenido.',
    action:
      'No vuelva a emitir el mismo documento. Si el paciente necesita otra receta, ' +
      'genérela como una receta nueva.',
  },

  'practitioner-credential-missing': {
    headline: 'CREDENCIAL SIN VIGENCIA',
    reason: (reason, format) =>
      `La credencial médica de la cuenta ${format.address(reason.account)} no está vigente.`,
    action:
      'No es posible emitir recetas nuevas mientras la credencial no esté vigente. ' +
      'Las recetas ya emitidas siguen en la cadena tal como se registraron. ' +
      'Contacte con la entidad que emitió su matrícula profesional.',
  },

  'invalid-expiry': {
    headline: 'VIGENCIA NO VÁLIDA',
    reason: (reason, format) =>
      reason.expiresAt === 0n
        ? 'La fecha de vencimiento no puede quedar vacía.'
        : `La fecha de vencimiento indicada (${format.day(reason.expiresAt)}) ya pasó para ` +
          'la hora de la cadena.',
    action: 'Corrija los días de validez de la receta y vuelva a emitir.',
  },

  'transaction-reverted': {
    headline: 'REGISTRO RECHAZADO',
    reason: () => 'La cadena revirtió el registro de esta receta al confirmar la transacción.',
    action:
      'La receta no quedó registrada y el paciente no tiene ningún código válido. Vuelva a ' +
      'intentarlo; si el rechazo se repite, contacte con el responsable técnico de la clínica.',
  },

  'network-error': {
    headline: 'EMISIÓN INCOMPLETA',
    reason: (reason) => reason.message,
    action:
      'Compruebe la conexión del equipo y vuelva a intentarlo. No entregue ningún código ' +
      'al paciente hasta que la receta aparezca como emitida.',
  },
};

/** A rendered refusal, ready for the screen. */
export interface IssueRejectionMessage {
  code: IssueRejectionCode;
  headline: string;
  reason: string;
  action: string;
}

/**
 * Renders a rejection into its screen copy.
 *
 * The switch exists so TypeScript can pair each reason with the copy entry that
 * accepts it; indexing the catalogue with a union key would lose that pairing.
 */
export function describeIssueRejection(
  reason: IssueRejection,
  format: IssueFormatters = DEFAULT_ISSUE_FORMATTERS,
): IssueRejectionMessage {
  const render = (): string => {
    switch (reason.code) {
      case 'document-invalid':
        return ISSUE_REJECTION_COPY_ES['document-invalid'].reason(reason, format);
      case 'signer-unavailable':
        return ISSUE_REJECTION_COPY_ES['signer-unavailable'].reason(reason, format);
      case 'store-failed':
        return ISSUE_REJECTION_COPY_ES['store-failed'].reason(reason, format);
      case 'already-issued':
        return ISSUE_REJECTION_COPY_ES['already-issued'].reason(reason, format);
      case 'practitioner-credential-missing':
        return ISSUE_REJECTION_COPY_ES['practitioner-credential-missing'].reason(reason, format);
      case 'invalid-expiry':
        return ISSUE_REJECTION_COPY_ES['invalid-expiry'].reason(reason, format);
      case 'transaction-reverted':
        return ISSUE_REJECTION_COPY_ES['transaction-reverted'].reason(reason, format);
      case 'network-error':
        return ISSUE_REJECTION_COPY_ES['network-error'].reason(reason, format);
    }
  };

  const copy = ISSUE_REJECTION_COPY_ES[reason.code];

  return {
    code: reason.code,
    headline: copy.headline,
    reason: render(),
    action: copy.action,
  };
}

/**
 * The warning screen D6 must show beside the QR (docs/17, D-24).
 *
 * Whoever holds the code can read the prescription. That is deliberate and
 * equivalent to holding the paper today, and the interface says so plainly
 * rather than implying a protection the MVP does not have.
 */
export const QR_DISCLOSURE_WARNING_ES =
  'Quien tenga este código puede leer la receta completa, igual que ocurre con la receta en ' +
  'papel. Entréguelo únicamente al paciente o a quien él autorice.';

/** The ADSIB notice of screen D5 (D-17): declared, and honestly unintegrated. */
export const ADSIB_PENDING_NOTICE_ES =
  'La firma con certificado ADSIB todavía no está integrada. Esta receta lleva firma ' +
  'electrónica verificable en la cadena, y no sustituye a la firma digital reconocida.';
