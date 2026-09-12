import { decodeRegistryRevertData, toRegistryRevert, type RegistryRevert } from '@recetas/chain';
import { formatDateTime, formatDay, shortAddress } from './format';

/**
 * Decoding of the custom errors of PrescriptionRegistry
 * (docs/04-smart-contracts.md).
 *
 * Every error gets its own headline, its own explanation and its own next step.
 * Collapsing "already dispensed" and "tampered content" into one generic
 * failure turns two very different situations into the same shrug
 * (docs/17-diseno-y-experiencia.md).
 *
 * The decoding itself — the `BaseError` walk, the cause-chain recursion over
 * raw revert data and the defensive argument readers — moved to @recetas/chain,
 * where apps/pharmacy and the doctor app share it (review finding read-002,
 * lineage review-fbc6fee420beae2b). What stays here is what is the CLI's own:
 * the words the terminal prints.
 */

export interface RegistryRejection {
  /**
   * Stable machine code for the rejection: the Solidity custom error name for
   * an on-chain revert, or a client-side check name for the integrity,
   * signature and correspondence checks the pharmacy runs locally.
   */
  code: string;
  /** Headline of the verdict box. Short enough to read across a room. */
  title: string;
  /** The concrete reason, with who and when whenever the error carries it. */
  detail: string;
  /** What the person at the counter should do next. */
  action: string;
}

function describe(revert: RegistryRevert): RegistryRejection {
  switch (revert.name) {
    case 'AlreadyDispensed':
      return {
        code: revert.name,
        title: 'NO ENTREGAR',
        detail:
          `Esta receta ya fue dispensada el ${formatDateTime(revert.dispensedAt)}\n` +
          `por la farmacia ${shortAddress(revert.dispensedBy)}`,
        action:
          'No entregue el medicamento. La dispensación es única e irreversible: ' +
          'no existe ninguna forma de reabrir esta receta.',
      };

    case 'UnknownPrescription':
      return {
        code: revert.name,
        title: 'NO ENTREGAR',
        detail: 'Esta receta no figura en el registro de la cadena.',
        action:
          'El código no corresponde a ninguna receta emitida. Rechace la entrega y ' +
          'pida al paciente el código original.',
      };

    case 'PrescriptionExpired':
      return {
        code: revert.name,
        title: 'RECETA CADUCADA',
        detail: `La validez de esta receta terminó el ${formatDay(revert.expiresAt)}.`,
        action: 'No entregue el medicamento. El paciente necesita una receta nueva.',
      };

    case 'PrescriptionCancelledError':
      return {
        code: revert.name,
        title: 'RECETA ANULADA',
        detail: 'El médico prescriptor anuló esta receta antes de su dispensación.',
        action: 'No entregue el medicamento. Remita al paciente a su médico.',
      };

    case 'NotAccreditedPharmacy':
      return {
        code: revert.name,
        title: 'FARMACIA SIN CREDENCIAL',
        detail: `La cuenta ${shortAddress(revert.caller)} no tiene una credencial de farmacia vigente.`,
        action: 'La dispensación no puede registrarse. Verifique el estado de su acreditación.',
      };

    case 'NotAccreditedPractitioner':
      return {
        code: revert.name,
        title: 'MÉDICO SIN CREDENCIAL',
        detail: `La cuenta ${shortAddress(revert.caller)} no tiene una credencial médica vigente.`,
        action: 'La receta no puede emitirse. Verifique la matrícula profesional registrada.',
      };

    case 'NotPrescriber':
      return {
        code: revert.name,
        title: 'ANULACIÓN NO AUTORIZADA',
        detail:
          `La cuenta ${shortAddress(revert.caller)} no emitió esta receta; ` +
          `el prescriptor es ${shortAddress(revert.prescriber)}.`,
        action: 'Solo el médico que emitió la receta puede anularla.',
      };

    case 'AlreadyIssued':
      return {
        code: revert.name,
        title: 'RECETA YA REGISTRADA',
        detail: 'Ya existe una receta con esta huella de contenido en la cadena.',
        action: 'No vuelva a emitir el mismo documento: genere una receta nueva.',
      };

    case 'InvalidExpiry':
      return {
        code: revert.name,
        title: 'CADUCIDAD INVÁLIDA',
        detail:
          revert.expiresAt === 0n
            ? 'La fecha de caducidad no puede quedar vacía.'
            : `La fecha de caducidad indicada (${formatDay(revert.expiresAt)}) no es posterior a la hora del bloque.`,
        action: 'Corrija la fecha de vencimiento y vuelva a emitir.',
      };

    // --- Credential registration ------------------------------------------
    // Registration is permissionless, so a refusal has to name which of the
    // five checks failed. "No accreditation" alone leaves the pharmacist
    // choosing between a typo, the wrong issuer and a withdrawn licence.

    case 'InvalidCredentialUid':
      return {
        code: revert.name,
        title: 'CREDENCIAL VACÍA',
        detail: 'No se indicó ningún identificador de attestation.',
        action: 'Indique el uid de la credencial emitida por la autoridad.',
      };

    case 'CredentialNotFound':
      return {
        code: revert.name,
        title: 'CREDENCIAL INEXISTENTE',
        detail: `No existe ninguna attestation con el uid ${revert.uid}.`,
        action: 'Confirme el uid con la autoridad que emitió su credencial.',
      };

    case 'CredentialNotForCaller':
      return {
        code: revert.name,
        title: 'CREDENCIAL DE OTRA CUENTA',
        detail:
          `La credencial fue emitida a ${shortAddress(revert.recipient)} y ` +
          `la está registrando ${shortAddress(revert.caller)}.`,
        action: 'Cada profesional registra únicamente la credencial emitida a su propia cuenta.',
      };

    case 'CredentialWrongIssuer':
      return {
        code: revert.name,
        title: 'EMISOR NO AUTORIZADO',
        detail:
          `La attestation la firmó ${shortAddress(revert.attester)}, y el único emisor ` +
          `reconocido es ${shortAddress(revert.expectedIssuer)}.`,
        action:
          'Cualquiera puede emitir una attestation; solo cuenta la de la autoridad del piloto. ' +
          'Solicite su credencial a esa autoridad.',
      };

    case 'CredentialUnknownSchema':
      return {
        code: revert.name,
        title: 'ESQUEMA DESCONOCIDO',
        detail: `La credencial usa el esquema ${revert.schema}, que no es ni el de médico ni el de farmacia.`,
        action: 'Solicite una credencial emitida con el esquema profesional correspondiente.',
      };

    case 'CredentialRevoked':
      return {
        code: revert.name,
        title: 'CREDENCIAL REVOCADA',
        detail: `Esta credencial fue revocada el ${formatDay(revert.revocationTime)}.`,
        action:
          'Una credencial revocada no habilita ninguna operación. Tramite una credencial nueva ' +
          'ante la autoridad emisora.',
      };

    case 'CredentialExpired':
      return {
        code: revert.name,
        title: 'CREDENCIAL CADUCADA',
        detail: `La vigencia de esta credencial terminó el ${formatDay(revert.expirationTime)}.`,
        action: 'Renueve la credencial ante la autoridad emisora y vuelva a registrarla.',
      };
  }
}

/**
 * Last resort for a revert the registry does not declare.
 *
 * Naming the error is still more than "transaction reverted", and it is the
 * only thing that can be said about a failure nobody modelled.
 */
function describeUnknown(errorName: string): RegistryRejection {
  return {
    code: errorName,
    title: 'OPERACIÓN RECHAZADA',
    detail: `El contrato rechazó la operación con el error ${errorName}.`,
    action: 'Revise los datos enviados antes de reintentar.',
  };
}

/** Pulls a decoded custom error out of whatever viem threw. */
export function decodeRegistryError(error: unknown): RegistryRejection | undefined {
  const decoded = decodeRegistryRevertData(error);
  if (decoded === undefined) return undefined;

  const revert = toRegistryRevert(decoded.errorName, decoded.args);
  return revert === undefined ? describeUnknown(decoded.errorName) : describe(revert);
}
