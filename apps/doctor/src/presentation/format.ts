import { DEFAULT_ISSUE_FORMATTERS } from '../domain/issuance';

/**
 * Presentation formatting, shared by every screen.
 *
 * The catalogue in domain/issuance.ts already pins the clinic timezone and the
 * short-address shape; re-exporting them here keeps a single rendering of an
 * address across D5, D6 and D7 instead of two that disagree by a character.
 *
 * Mirrors apps/pharmacy/src/presentation/format.ts.
 */

/**
 * "11/10/2026". Expiry is a DAY, not an instant (D-13, docs/17).
 *
 * There is deliberately no `formatDateTime` here for an expiry: the contract
 * refuses a dispensation from midnight of that day, so showing a time would
 * invite the doctor to promise the patient hours that do not exist.
 */
export const formatDay = DEFAULT_ISSUE_FORMATTERS.day;

/** "0x51Ae…8837", so two addresses can be compared column by column. */
export const formatAddress = DEFAULT_ISSUE_FORMATTERS.address;

/**
 * "0x9f2c41ab…9b7a2" for a 32-byte hash.
 *
 * The full value is always rendered somewhere on the same screen; this is the
 * glanceable form for a heading or a list row.
 */
export function shortHash(value: string): string {
  return value.length <= 20 ? value : `${value.slice(0, 10)}…${value.slice(-5)}`;
}

/** Block numbers read as counters, not as amounts, so they get thousands marks. */
export function formatBlockNumber(value: bigint): string {
  return new Intl.NumberFormat('es-BO').format(value);
}

/** Splits a comma-separated free-text field into the list the engine evaluates. */
export function splitDeclaredList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** The inverse, so the form can round-trip what the draft already holds. */
export function joinDeclaredList(values: readonly string[]): string {
  return values.join(', ');
}
