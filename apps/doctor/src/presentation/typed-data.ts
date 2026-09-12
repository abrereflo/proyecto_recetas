import { MVP_NONCE } from '@recetas/chain';
import type { Address } from '@recetas/shared';
import type { PrescriptionDraft } from '../domain/draft';
import { formatDay } from './format';

/**
 * Screen D5: the EIP-712 message, rendered as readable Spanish sentences.
 *
 * HARD RULE (docs/17, D5): "Datos tipados como frases legibles, nunca un
 * hexadecimal." A doctor who signs something they cannot read is not
 * consenting, they are obeying. So each field of `PrescriptionMessage`
 * (packages/chain/src/eip712.ts) becomes one sentence about what it commits to,
 * and the two 32-byte values are DESCRIBED rather than printed: at the moment
 * this screen renders they do not exist yet — `contentHash` is derived from the
 * ciphertext and `patientCommitment` from the salt, both inside the issuing
 * pipeline, after the doctor has pressed the button. Printing a placeholder hex
 * would be worse than printing nothing: it would be a value the signature is
 * not about.
 *
 * Pure: every instant arrives as a parameter, so the sentences are testable.
 */

export interface SignatureSentence {
  /** The field of the typed message this sentence stands for. */
  field: string;
  /** What signing commits the prescriber to, in the doctor's language. */
  sentence: string;
}

export interface DescribeSignatureInput {
  draft: PrescriptionDraft;
  /** The account the chain will record as `prescriber`. */
  prescriber: Address;
  /** Unix seconds, midnight of the expiry day (D-13). */
  expiresAt: bigint;
  /** The issuing day, as the doctor will see it recorded. */
  issuedAt: Date;
  chainId: number;
}

export function describePrescriptionSignature(input: DescribeSignatureInput): SignatureSentence[] {
  const { draft, expiresAt, issuedAt, chainId } = input;
  const issuedDay = formatDay(BigInt(Math.floor(issuedAt.getTime() / 1000)));

  return [
    {
      field: 'Prescriptor',
      sentence:
        `Usted firma como ${draft.practitioner.fullName || 'prescriptor sin nombre'}, ` +
        `matrícula ${draft.practitioner.licenseNumber || 'sin indicar'}.`,
    },
    {
      field: 'Contenido de la receta',
      sentence:
        `Firma ${itemCount(draft)} tal como ${draft.items.length === 1 ? 'está escrito' : 'están escritos'} ` +
        'en el formulario. El documento se cifra en este equipo antes de firmarse, y lo que se ' +
        'firma es la huella de ese documento cifrado: si después cambiara una sola letra, la ' +
        'firma dejaría de corresponder.',
    },
    {
      field: 'Paciente',
      sentence:
        `El paciente queda identificado como ${draft.patient.fullName || 'paciente sin nombre'} ` +
        'únicamente dentro del documento cifrado. A la cadena viaja un compromiso que se calcula ' +
        'en este equipo y que no permite deducir su documento de identidad.',
    },
    {
      field: 'Fecha de emisión',
      sentence: `Queda registrada con fecha ${issuedDay}.`,
    },
    {
      field: 'Vigencia',
      sentence:
        `Podrá dispensarse hasta el ${formatDay(expiresAt)}; a medianoche de ese día caduca ` +
        'por sí sola.',
    },
    {
      field: 'Número de firma',
      sentence:
        `Esta receta se firma una sola vez (número ${MVP_NONCE.toString()}). La cadena rechaza ` +
        'una segunda receta con el mismo contenido.',
    },
    {
      field: 'Registro',
      sentence:
        `La firma solo vale para el registro de recetas de la cadena ${chainId}. En cualquier ` +
        'otro sistema no significa nada.',
    },
  ];
}

function itemCount(draft: PrescriptionDraft): string {
  return draft.items.length === 1 ? '1 medicamento' : `${draft.items.length} medicamentos`;
}
