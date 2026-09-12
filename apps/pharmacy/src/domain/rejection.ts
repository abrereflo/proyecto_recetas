import type { Address, Bytes32 } from '@recetas/shared';

/**
 * Rejection catalogue for the pharmacy PWA (docs/17, screens P6 and P7).
 *
 * HARD RULE (docs/17, "El rechazo nombra a quién y cuándo"): every reason gets
 * its own headline, its own explanation and its own next step. Collapsing
 * "already dispensed" and "tampered content" into one generic failure turns two
 * very different situations into the same shrug, so no generic fallback copy
 * exists in this file on purpose.
 *
 * HARD RULE (docs/17, docs/04): there is NO reopen and NO undo path for a
 * dispensed prescription. This module must never model, name or hint at one.
 *
 * HARD RULE (docs/17): the words "wallet", "frase semilla" and "saldo" never
 * appear in interface copy. Enforced by rejection.test.ts.
 *
 * HARD RULE (docs/07, docs/17): revocation is communicated as future access
 * being revoked, NEVER as anything being retroactively deleted.
 *
 * HARD RULE (docs/03): no patient identifier and no commitment salt may reach
 * this catalogue. Nothing here interpolates `patient.patientId` or
 * `document.salt`, and `network-error` messages are written by infrastructure
 * that is forbidden from carrying them.
 *
 * Identifiers and comments are English; only the `es` copy strings are Spanish.
 */

export type RejectionCode =
  | 'already-dispensed'
  | 'expired'
  | 'cancelled'
  | 'unknown-prescription'
  | 'pharmacy-credential-revoked'
  | 'integrity-failed'
  | 'signature-failed'
  | 'patient-mismatch'
  | 'wrong-deployment'
  | 'network-error';

/**
 * The verdict, with the evidence the screen needs to name who and when.
 *
 * `already-dispensed` is the reason the product exists (docs/00, docs/04,
 * docs/17 P6): it carries `dispensedBy` and `dispensedAt` straight from the
 * contract's `AlreadyDispensed` error so the screen can accuse with a date and
 * an address instead of saying "operación fallida".
 */
export type RejectionReason =
  | { code: 'already-dispensed'; dispensedBy: Address; dispensedAt: bigint }
  /**
   * CLIENT-DERIVED. `Expired` is not a value of the on-chain enum: it is the
   * condition `referenceTimestamp >= expiresAt` evaluated against BLOCK time
   * (docs/04, docs/17). Deriving it before calling `dispense()` means no gas is
   * burnt on a doomed transaction, but the on-chain `PrescriptionExpired`
   * revert lands on this very same code as a fallback for the clock/block race.
   */
  | { code: 'expired'; expiresAt: bigint }
  | { code: 'cancelled' }
  | { code: 'unknown-prescription' }
  | { code: 'pharmacy-credential-revoked'; account: Address }
  | { code: 'integrity-failed'; anchoredContentHash: Bytes32; storedContentHash: Bytes32 }
  | { code: 'signature-failed'; signer: Address; prescriber: Address }
  | { code: 'patient-mismatch' }
  /**
   * The QR belongs to another chain or to another registry deployment.
   *
   * This is NOT a network failure: nothing was asked of the network and nothing
   * failed. Reporting it as `network-error` told the pharmacist to check the
   * connection, which cannot fix a code that a different system issued. It is
   * also NOT a verdict about the prescription: the receta may be perfectly
   * valid where it was registered.
   *
   * `actualRegistry` stays a plain `string` because it is untrusted input read
   * off a QR, not an address this application vouches for.
   */
  | {
      code: 'wrong-deployment';
      expectedChainId: number;
      actualChainId: number;
      expectedRegistry: Address;
      actualRegistry: string;
    }
  /**
   * Environment-level failure: the RPC node or the off-chain store did not
   * answer. It is NOT a verdict about the prescription, and the copy must not
   * read like one. `message` is authored by infrastructure and must never carry
   * clinical data, a patient identifier or a salt.
   */
  | { code: 'network-error'; message: string };

/** Narrows the union to the member carrying a given code. */
export type RejectionReasonOf<C extends RejectionCode> = Extract<RejectionReason, { code: C }>;

/**
 * Presentation helpers injected into the copy so the catalogue itself stays a
 * pure function of its inputs and the tests stay deterministic.
 */
export interface RejectionFormatters {
  /** "11/09/2026 09:42". Unix seconds in, Bolivian local time out. */
  dateTime(timestamp: bigint): string;
  /** "11/09/2026". Expiry is a day, not an instant (D-13, docs/17). */
  day(timestamp: bigint): string;
  /** "0x51Ae…8837". Rendered in a monospaced face by the UI (docs/17). */
  address(value: Address): string;
}

/** Bolivia is UTC-4 year round; pinning it keeps the same verdict on every device. */
const TIME_ZONE = 'America/La_Paz';
const LOCALE = 'es-BO';

function toDate(timestamp: bigint): Date {
  return new Date(Number(timestamp) * 1000);
}

export const DEFAULT_REJECTION_FORMATTERS: RejectionFormatters = {
  dateTime(timestamp) {
    return new Intl.DateTimeFormat(LOCALE, {
      timeZone: TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(toDate(timestamp));
  },
  day(timestamp) {
    return new Intl.DateTimeFormat(LOCALE, {
      timeZone: TIME_ZONE,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(toDate(timestamp));
  },
  address(value) {
    return value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
  },
};

export interface RejectionCopy<C extends RejectionCode> {
  /** Verdict headline. 48 px on screen, readable from three metres (docs/17). */
  headline: string;
  /** The concrete reason, naming who and when whenever the evidence carries it. */
  reason: (reason: RejectionReasonOf<C>, format: RejectionFormatters) => string;
  /** What the person at the counter does next. One distinct action per code. */
  action: string;
}

export type RejectionCopyCatalogue = { [C in RejectionCode]: RejectionCopy<C> };

/**
 * Spanish interface copy, neutral professional register (docs/17 P6 and P7).
 *
 * No entry says or implies that a dispensation can be reopened, reverted or
 * undone, because no such operation exists in the contract (docs/04).
 */
export const REJECTION_COPY_ES: RejectionCopyCatalogue = {
  // P6 — the verdict the pitch is built around.
  'already-dispensed': {
    headline: 'NO ENTREGAR',
    reason: (reason, format) =>
      `Esta receta ya fue dispensada el ${format.dateTime(reason.dispensedAt)} ` +
      `por la farmacia ${format.address(reason.dispensedBy)}.`,
    action:
      'No entregue el medicamento. La dispensación es única y definitiva: una receta ' +
      'dispensada no vuelve a habilitarse en ninguna farmacia. Indique al paciente que ' +
      'solicite una receta nueva a su médico.',
  },

  expired: {
    headline: 'RECETA CADUCADA',
    reason: (reason, format) => `La validez de esta receta terminó el ${format.day(reason.expiresAt)}.`,
    action: 'No entregue el medicamento. El paciente necesita una receta nueva emitida por su médico.',
  },

  cancelled: {
    headline: 'RECETA ANULADA',
    reason: () => 'El médico prescriptor anuló esta receta antes de su dispensación.',
    action: 'No entregue el medicamento. Remita al paciente a su médico.',
  },

  'unknown-prescription': {
    headline: 'CÓDIGO NO RECONOCIDO',
    reason: () => 'Este código no corresponde a ninguna receta registrada en la cadena.',
    action:
      'No entregue el medicamento. Pida al paciente el código original emitido por su médico.',
  },

  'pharmacy-credential-revoked': {
    headline: 'CREDENCIAL SIN VIGENCIA',
    // Revocation cuts FUTURE access. It deletes nothing that already happened
    // (docs/07, docs/17): claiming otherwise would be false and has legal
    // consequences.
    reason: (reason, format) =>
      `La credencial de farmacia de la cuenta ${format.address(reason.account)} no está vigente.`,
    action:
      'No es posible registrar nuevas dispensaciones mientras la credencial no esté vigente. ' +
      'Las dispensaciones ya registradas siguen en la cadena tal como se realizaron. ' +
      'Contacte con la entidad que emitió su credencial.',
  },

  'integrity-failed': {
    headline: 'CONTENIDO ALTERADO',
    reason: () =>
      'El documento guardado fuera de la cadena no coincide con la huella que el médico ' +
      'registró al emitir la receta.',
    action:
      'No entregue el medicamento y avise a la clínica emisora: el contenido fue modificado ' +
      'o sustituido después de la emisión.',
  },

  'signature-failed': {
    headline: 'FIRMA NO VÁLIDA',
    reason: (reason, format) =>
      reason.signer.toLowerCase() === reason.prescriber.toLowerCase()
        ? 'La firma electrónica no corresponde a los datos que la cadena registró para esta receta.'
        : `El documento está firmado por ${format.address(reason.signer)}, y la receta fue ` +
          `registrada por ${format.address(reason.prescriber)}.`,
    action: 'No entregue el medicamento. Avise a la clínica emisora.',
  },

  'patient-mismatch': {
    headline: 'PACIENTE NO COINCIDE',
    reason: () =>
      'El paciente del documento descifrado no corresponde al compromiso que se ancló en la ' +
      'cadena al emitir esta receta.',
    action:
      'No entregue el medicamento. Avise a la clínica emisora: la receta descifrada pertenece ' +
      'a otra persona.',
  },

  'wrong-deployment': {
    headline: 'CÓDIGO DE OTRO SISTEMA',
    // Nothing failed and nothing is wrong with the receta: this device is
    // simply pointed at a different deployment than the one that issued it.
    // Saying "revise la conexión" here would send the pharmacist to fix a
    // network that is working perfectly.
    reason: (reason) =>
      reason.actualChainId !== reason.expectedChainId
        ? `Este código fue emitido en la cadena ${reason.actualChainId} y esta aplicación ` +
          `está conectada a la cadena ${reason.expectedChainId}.`
        : 'Este código fue emitido en otro registro de recetas, distinto del que esta ' +
          'aplicación tiene configurado.',
    action:
      'No entregue el medicamento con este código. La receta puede ser correcta en el ' +
      'sistema donde se emitió, pero esta aplicación no puede comprobarla. Avise al ' +
      'responsable técnico de la farmacia para que revise la configuración del dispositivo.',
  },

  'network-error': {
    headline: 'VERIFICACIÓN INCOMPLETA',
    reason: (reason) => reason.message,
    action:
      'No entregue el medicamento sin completar la verificación. Revise la conexión del ' +
      'dispositivo y vuelva a escanear el código.',
  },
};

/** A rendered verdict, ready for the screen. */
export interface RejectionMessage {
  code: RejectionCode;
  headline: string;
  reason: string;
  action: string;
}

/**
 * Renders a reason into its screen copy.
 *
 * The switch exists so TypeScript can pair each reason with the copy entry that
 * accepts it; indexing the catalogue with a union key would lose that pairing.
 */
export function describeRejection(
  reason: RejectionReason,
  format: RejectionFormatters = DEFAULT_REJECTION_FORMATTERS,
): RejectionMessage {
  const render = (): string => {
    switch (reason.code) {
      case 'already-dispensed':
        return REJECTION_COPY_ES['already-dispensed'].reason(reason, format);
      case 'expired':
        return REJECTION_COPY_ES.expired.reason(reason, format);
      case 'cancelled':
        return REJECTION_COPY_ES.cancelled.reason(reason, format);
      case 'unknown-prescription':
        return REJECTION_COPY_ES['unknown-prescription'].reason(reason, format);
      case 'pharmacy-credential-revoked':
        return REJECTION_COPY_ES['pharmacy-credential-revoked'].reason(reason, format);
      case 'integrity-failed':
        return REJECTION_COPY_ES['integrity-failed'].reason(reason, format);
      case 'signature-failed':
        return REJECTION_COPY_ES['signature-failed'].reason(reason, format);
      case 'patient-mismatch':
        return REJECTION_COPY_ES['patient-mismatch'].reason(reason, format);
      case 'wrong-deployment':
        return REJECTION_COPY_ES['wrong-deployment'].reason(reason, format);
      case 'network-error':
        return REJECTION_COPY_ES['network-error'].reason(reason, format);
    }
  };

  const copy = REJECTION_COPY_ES[reason.code];

  return {
    code: reason.code,
    headline: copy.headline,
    reason: render(),
    action: copy.action,
  };
}
