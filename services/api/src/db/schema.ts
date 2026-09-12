import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Off-chain encrypted payload store (docs/05-almacenamiento-y-cifrado.md, D-08).
 *
 * What the chain anchors is `keccak256(ciphertext)`. This table holds the
 * ciphertext itself, so tampering with a row is detectable by the pharmacy, not
 * by us.
 *
 * HARD RULES for this table:
 *  - No patient identifier, no plaintext clinical field, ever.
 *  - `salt` must never be logged, returned by a read endpoint, or put in a URL.
 *    If it leaks, the on-chain commitment stops protecting the patient
 *    (docs/03-modelo-de-datos.md).
 *  - The DEK is NOT stored here. In the MVP it travels in the QR (D-24).
 */
export const prescriptions = pgTable('prescriptions', {
  /** Opaque pointer handed back to the client and carried in the QR. */
  pointer: text('pointer').primaryKey(),
  /** base64 of the AES-256-GCM ciphertext envelope. */
  ciphertext: text('ciphertext').notNull(),
  /** Hex of the per-prescription commitment salt. Write-only from outside. */
  salt: text('salt').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PrescriptionRow = typeof prescriptions.$inferSelect;
export type NewPrescriptionRow = typeof prescriptions.$inferInsert;
