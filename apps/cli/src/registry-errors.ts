import { BaseError, ContractFunctionRevertedError, decodeErrorResult, type Hex } from 'viem';
import { prescriptionRegistryAbi } from './registry-abi';
import { formatDateTime, formatDay, shortAddress } from './format';

/**
 * Decoding of the custom errors of PrescriptionRegistry
 * (docs/04-smart-contracts.md).
 *
 * Every error gets its own headline, its own explanation and its own next step.
 * Collapsing "already dispensed" and "tampered content" into one generic
 * failure turns two very different situations into the same shrug
 * (docs/17-diseno-y-experiencia.md).
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

function argAt(args: readonly unknown[] | undefined, index: number): unknown {
  return args === undefined ? undefined : args[index];
}

function addressArg(args: readonly unknown[] | undefined, index: number): string {
  const value = argAt(args, index);
  return typeof value === 'string' ? value : '0x0000000000000000000000000000000000000000';
}

function timestampArg(args: readonly unknown[] | undefined, index: number): bigint {
  const value = argAt(args, index);
  return typeof value === 'bigint' ? value : 0n;
}

function bytes32Arg(args: readonly unknown[] | undefined, index: number): string {
  const value = argAt(args, index);
  return typeof value === 'string' ? value : '0x';
}

function describe(errorName: string, args: readonly unknown[] | undefined): RegistryRejection {
  switch (errorName) {
    case 'AlreadyDispensed': {
      const dispensedBy = addressArg(args, 1);
      const dispensedAt = timestampArg(args, 2);
      return {
        code: errorName,
        title: 'NO ENTREGAR',
        detail:
          `Esta receta ya fue dispensada el ${formatDateTime(dispensedAt)}\n` +
          `por la farmacia ${shortAddress(dispensedBy)}`,
        action:
          'No entregue el medicamento. La dispensación es única e irreversible: ' +
          'no existe ninguna forma de reabrir esta receta.',
      };
    }

    case 'UnknownPrescription':
      return {
        code: errorName,
        title: 'NO ENTREGAR',
        detail: 'Esta receta no figura en el registro de la cadena.',
        action:
          'El código no corresponde a ninguna receta emitida. Rechace la entrega y ' +
          'pida al paciente el código original.',
      };

    case 'PrescriptionExpired': {
      const expiresAt = timestampArg(args, 1);
      return {
        code: errorName,
        title: 'RECETA CADUCADA',
        detail: `La validez de esta receta terminó el ${formatDay(expiresAt)}.`,
        action: 'No entregue el medicamento. El paciente necesita una receta nueva.',
      };
    }

    case 'PrescriptionCancelledError':
      return {
        code: errorName,
        title: 'RECETA ANULADA',
        detail: 'El médico prescriptor anuló esta receta antes de su dispensación.',
        action: 'No entregue el medicamento. Remita al paciente a su médico.',
      };

    case 'NotAccreditedPharmacy': {
      const caller = addressArg(args, 0);
      return {
        code: errorName,
        title: 'FARMACIA SIN CREDENCIAL',
        detail: `La cuenta ${shortAddress(caller)} no tiene una credencial de farmacia vigente.`,
        action: 'La dispensación no puede registrarse. Verifique el estado de su acreditación.',
      };
    }

    case 'NotAccreditedPractitioner': {
      const caller = addressArg(args, 0);
      return {
        code: errorName,
        title: 'MÉDICO SIN CREDENCIAL',
        detail: `La cuenta ${shortAddress(caller)} no tiene una credencial médica vigente.`,
        action: 'La receta no puede emitirse. Verifique la matrícula profesional registrada.',
      };
    }

    case 'NotPrescriber': {
      const caller = addressArg(args, 0);
      const prescriber = addressArg(args, 1);
      return {
        code: errorName,
        title: 'ANULACIÓN NO AUTORIZADA',
        detail:
          `La cuenta ${shortAddress(caller)} no emitió esta receta; ` +
          `el prescriptor es ${shortAddress(prescriber)}.`,
        action: 'Solo el médico que emitió la receta puede anularla.',
      };
    }

    case 'AlreadyIssued':
      return {
        code: errorName,
        title: 'RECETA YA REGISTRADA',
        detail: 'Ya existe una receta con esta huella de contenido en la cadena.',
        action: 'No vuelva a emitir el mismo documento: genere una receta nueva.',
      };

    case 'InvalidExpiry': {
      const expiresAt = timestampArg(args, 0);
      return {
        code: errorName,
        title: 'CADUCIDAD INVÁLIDA',
        detail:
          expiresAt === 0n
            ? 'La fecha de caducidad no puede quedar vacía.'
            : `La fecha de caducidad indicada (${formatDay(expiresAt)}) no es posterior a la hora del bloque.`,
        action: 'Corrija la fecha de vencimiento y vuelva a emitir.',
      };
    }

    // --- Credential registration ------------------------------------------
    // Registration is permissionless, so a refusal has to name which of the
    // five checks failed. "No accreditation" alone leaves the pharmacist
    // choosing between a typo, the wrong issuer and a withdrawn licence.

    case 'InvalidCredentialUid':
      return {
        code: errorName,
        title: 'CREDENCIAL VACÍA',
        detail: 'No se indicó ningún identificador de attestation.',
        action: 'Indique el uid de la credencial emitida por la autoridad.',
      };

    case 'CredentialNotFound':
      return {
        code: errorName,
        title: 'CREDENCIAL INEXISTENTE',
        detail: `No existe ninguna attestation con el uid ${bytes32Arg(args, 0)}.`,
        action: 'Confirme el uid con la autoridad que emitió su credencial.',
      };

    case 'CredentialNotForCaller': {
      const caller = addressArg(args, 0);
      const recipient = addressArg(args, 1);
      return {
        code: errorName,
        title: 'CREDENCIAL DE OTRA CUENTA',
        detail:
          `La credencial fue emitida a ${shortAddress(recipient)} y ` +
          `la está registrando ${shortAddress(caller)}.`,
        action: 'Cada profesional registra únicamente la credencial emitida a su propia cuenta.',
      };
    }

    case 'CredentialWrongIssuer': {
      const attester = addressArg(args, 0);
      const expected = addressArg(args, 1);
      return {
        code: errorName,
        title: 'EMISOR NO AUTORIZADO',
        detail:
          `La attestation la firmó ${shortAddress(attester)}, y el único emisor ` +
          `reconocido es ${shortAddress(expected)}.`,
        action:
          'Cualquiera puede emitir una attestation; solo cuenta la de la autoridad del piloto. ' +
          'Solicite su credencial a esa autoridad.',
      };
    }

    case 'CredentialUnknownSchema':
      return {
        code: errorName,
        title: 'ESQUEMA DESCONOCIDO',
        detail: `La credencial usa el esquema ${bytes32Arg(args, 0)}, que no es ni el de médico ni el de farmacia.`,
        action: 'Solicite una credencial emitida con el esquema profesional correspondiente.',
      };

    case 'CredentialRevoked': {
      const revokedAt = timestampArg(args, 1);
      return {
        code: errorName,
        title: 'CREDENCIAL REVOCADA',
        detail: `Esta credencial fue revocada el ${formatDay(revokedAt)}.`,
        action:
          'Una credencial revocada no habilita ninguna operación. Tramite una credencial nueva ' +
          'ante la autoridad emisora.',
      };
    }

    case 'CredentialExpired': {
      const expiredAt = timestampArg(args, 1);
      return {
        code: errorName,
        title: 'CREDENCIAL CADUCADA',
        detail: `La vigencia de esta credencial terminó el ${formatDay(expiredAt)}.`,
        action: 'Renueve la credencial ante la autoridad emisora y vuelva a registrarla.',
      };
    }

    default:
      return {
        code: errorName,
        title: 'OPERACIÓN RECHAZADA',
        detail: `El contrato rechazó la operación con el error ${errorName}.`,
        action: 'Revise los datos enviados antes de reintentar.',
      };
  }
}

/**
 * Pulls a decoded custom error out of whatever viem threw.
 *
 * Two paths are covered: the rich `ContractFunctionRevertedError` raised by
 * `simulateContract`, and a bare revert data blob, which is what some nodes
 * return when the estimation path is skipped.
 */
export function decodeRegistryError(error: unknown): RegistryRejection | undefined {
  if (error instanceof BaseError) {
    const reverted = error.walk((candidate) => candidate instanceof ContractFunctionRevertedError);

    if (reverted instanceof ContractFunctionRevertedError && reverted.data !== undefined) {
      return describe(reverted.data.errorName, reverted.data.args);
    }
  }

  const raw = rawRevertData(error);
  if (raw !== undefined) {
    try {
      const decoded = decodeErrorResult({ abi: prescriptionRegistryAbi, data: raw });
      return describe(decoded.errorName, decoded.args as readonly unknown[] | undefined);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function rawRevertData(error: unknown): Hex | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  const candidate = (error as { data?: unknown }).data;
  if (typeof candidate === 'string' && candidate.startsWith('0x') && candidate.length >= 10) {
    return candidate as Hex;
  }

  const cause = (error as { cause?: unknown }).cause;
  return cause === undefined ? undefined : rawRevertData(cause);
}
