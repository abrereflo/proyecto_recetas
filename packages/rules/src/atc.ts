/**
 * WHO ATC code helpers.
 *
 * ATC classifies, it does not trace. A code says which therapeutic family a
 * drug belongs to; it identifies neither a commercial product nor a physical
 * unit. Unit traceability needs GS1 and is out of scope (docs/03, D-21).
 *
 * Level sizes, e.g. J01CA04:
 *   1 -> J        anatomical main group
 *   2 -> J01      therapeutic subgroup
 *   3 -> J01C     pharmacological subgroup
 *   4 -> J01CA    chemical subgroup   <- the level the duplication rule uses
 *   5 -> J01CA04  chemical substance
 */

const ATC_LEVEL_LENGTHS = [1, 3, 4, 5, 7] as const;

export type AtcLevel = 1 | 2 | 3 | 4 | 5;

export function normalizeAtcCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Truncate an ATC code to the requested level.
 * Returns null when the code is too short to have that level.
 */
export function atcLevel(code: string, level: AtcLevel): string | null {
  const normalized = normalizeAtcCode(code);
  const length = ATC_LEVEL_LENGTHS[level - 1];
  if (length === undefined || normalized.length < length) {
    return null;
  }
  return normalized.slice(0, length);
}

/** Chemical subgroup, e.g. "J01CA" for "J01CA04". */
export function atcLevel4(code: string): string | null {
  return atcLevel(code, 4);
}
