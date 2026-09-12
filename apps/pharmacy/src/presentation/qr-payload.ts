import { decodeQrPayload, type QrPayload } from '@recetas/shared';

/**
 * Reading a QR payload, from the camera (P2) or from the keyboard (P8).
 *
 * Both entry points go through this one function so manual entry can never
 * become a laxer path than the camera (docs/17, P8: the contingency runs the
 * same verification).
 *
 * The failure message is written for the counter, not for a console: whoever is
 * standing there cannot act on "Unexpected token < in JSON at position 0".
 */
export type QrReadResult = { ok: true; qr: QrPayload } | { ok: false; problem: string };

const NOT_A_PRESCRIPTION_CODE =
  'Este código no es una receta de este sistema. Compruebe que escaneó el código de la ' +
  'receta y no otro código del envase o del documento.';

const INCOMPLETE_CODE =
  'El contenido pegado está incompleto o le falta alguna parte. Copie el código de la ' +
  'receta completo, desde la primera llave hasta la última.';

export function readQrPayload(raw: string): QrReadResult {
  const trimmed = raw.trim();

  if (trimmed === '') {
    return { ok: false, problem: 'Pegue el contenido del código de la receta.' };
  }

  try {
    return { ok: true, qr: decodeQrPayload(trimmed) };
  } catch {
    // Two different mistakes, two different instructions: something that is not
    // JSON at all is the wrong code; JSON that does not fit the schema is a
    // truncated paste.
    const looksLikeJson = trimmed.startsWith('{') && trimmed.endsWith('}');
    return { ok: false, problem: looksLikeJson ? INCOMPLETE_CODE : NOT_A_PRESCRIPTION_CODE };
  }
}
