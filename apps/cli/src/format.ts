/**
 * Value formatting for the terminal.
 *
 * Bolivia keeps a fixed UTC-4 offset all year, so the clinic timezone is pinned
 * rather than taken from the host: a demo machine in another timezone must not
 * print a different dispensing hour than the pharmacy counter would.
 */

export const CLINIC_TIME_ZONE = 'America/La_Paz';
/** Bolivia does not observe daylight saving time. */
export const CLINIC_UTC_OFFSET = '-04:00';

const dateFormatter = new Intl.DateTimeFormat('es-BO', {
  timeZone: CLINIC_TIME_ZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const timeFormatter = new Intl.DateTimeFormat('es-BO', {
  timeZone: CLINIC_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function toDate(seconds: bigint | number): Date {
  return new Date(Number(seconds) * 1000);
}

/** Day only. Expiry is midnight of the given day, so the hour is noise (D-13). */
export function formatDay(seconds: bigint | number): string {
  return dateFormatter.format(toDate(seconds));
}

/** Day and time, the shape the rejection screen uses. */
export function formatDateTime(seconds: bigint | number): string {
  const date = toDate(seconds);
  return `${dateFormatter.format(date)} a las ${timeFormatter.format(date)}`;
}

/** `0x7099…79C8`: enough to recognise an account without a wall of hex. */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Unix seconds of the next midnight, `days` days ahead, in clinic time. */
export function midnightInDays(days: number, from: Date = new Date()): bigint {
  const target = new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLINIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(target);

  return BigInt(Math.floor(Date.parse(`${parts}T00:00:00${CLINIC_UTC_OFFSET}`) / 1000));
}

export function secondsToIso(seconds: bigint | number): string {
  return toDate(seconds).toISOString();
}

export function isoToSeconds(isoTimestamp: string): bigint {
  return BigInt(Math.floor(Date.parse(isoTimestamp) / 1000));
}
