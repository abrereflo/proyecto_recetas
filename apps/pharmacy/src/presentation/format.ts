import { DEFAULT_REJECTION_FORMATTERS } from '../domain/rejection';

/**
 * Presentation formatting, shared by every screen.
 *
 * The catalogue in domain/rejection.ts already pins Bolivian local time and the
 * short-address shape; re-exporting them here keeps a single rendering of an
 * address across P4, P5, P6 and P7 instead of two that disagree by a character.
 */

/** "11/09/2026 09:42", Bolivian local time. Unix seconds in. */
export const formatDateTime = DEFAULT_REJECTION_FORMATTERS.dateTime;

/** "11/09/2026". Expiry is a day, not an instant (D-13, docs/17). */
export const formatDay = DEFAULT_REJECTION_FORMATTERS.day;

/** "0x51aE…8837", so two addresses can be compared column by column. */
export const formatAddress = DEFAULT_REJECTION_FORMATTERS.address;

/**
 * "0x9f2c41ab…9b7a2" for a 32-byte hash.
 *
 * The full value is always rendered somewhere on the same screen; this is the
 * glanceable form for a heading or a list row.
 */
export function shortHash(value: string): string {
  return value.length <= 20 ? value : `${value.slice(0, 10)}…${value.slice(-5)}`;
}

/** ISO 8601 from the decrypted document to a Bolivian day. */
export function formatIsoDay(iso: string): string {
  const millis = Date.parse(iso);
  if (Number.isNaN(millis)) return iso;
  return formatDay(BigInt(Math.floor(millis / 1000)));
}

/** Block numbers read as counters, not as amounts, so they get thousands marks. */
export function formatBlockNumber(value: bigint): string {
  return new Intl.NumberFormat('es-BO').format(value);
}
