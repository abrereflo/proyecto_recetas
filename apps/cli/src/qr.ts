import { readFileSync } from 'node:fs';
import QRCode from 'qrcode';
import { decodeQrPayload, type QrPayload } from '@recetas/shared';

/**
 * The QR envelope, rendered and read back.
 *
 * HARD RULE: the commitment salt never appears in this payload. Only the
 * pointer and the unwrapped DEK travel here, and only while D-24 stays open
 * (docs/03-modelo-de-datos.md, docs/05-almacenamiento-y-cifrado.md).
 */

/** ASCII art QR, readable by a phone camera pointed at the terminal. */
export async function renderQrAscii(payload: string): Promise<string> {
  return QRCode.toString(payload, { type: 'terminal', small: true, errorCorrectionLevel: 'L' });
}

/**
 * Accepts either the JSON payload itself or a path to a file holding it, which
 * is what makes `receta verify` usable both from a pipe and from a saved file.
 */
export function readQrArgument(value: string): QrPayload {
  const trimmed = value.trim();

  if (trimmed.startsWith('{')) {
    return decodeQrPayload(trimmed);
  }

  let contents: string;
  try {
    contents = readFileSync(trimmed, 'utf8');
  } catch {
    throw new Error(
      `No se pudo leer el QR: "${value}" no es JSON ni un archivo legible. ` +
        'Pase el JSON entre comillas o la ruta del archivo generado por "receta issue --out".',
    );
  }

  return decodeQrPayload(contents);
}
