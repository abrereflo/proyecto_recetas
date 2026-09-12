/**
 * @recetas/chain — everything that talks to `PrescriptionRegistry`.
 *
 * WHY THIS PACKAGE EXISTS. A bounded code review (lineage
 * review-fbc6fee420beae2b) raised two WARNING findings against the state where
 * apps/cli and apps/pharmacy each kept their own copy:
 *
 * - read-001: `prescriptionRegistryAbi` was duplicated byte-identically, with
 *   no parity test. The stated reason for not sharing it — that a shared
 *   package would drag viem into @recetas/shared — did not hold: the ABI is a
 *   plain `as const` literal with no viem import, and the right answer was a
 *   separate chain-facing package rather than widening @recetas/shared, which
 *   depends only on zod.
 * - read-002: the contract-revert decoding pipeline was reimplemented
 *   independently in both apps, with the same control flow, so a new Solidity
 *   custom error could be mapped in one app and silently missed in the other.
 *
 * The pharmacy's copy of the ABI already carried a TODO to promote it to its
 * own package once a third consumer appeared. The doctor app is that consumer.
 *
 * WHAT BELONGS HERE. Decoding, plumbing and wire formats: the things where two
 * copies can silently disagree about what the chain said. WHAT DOES NOT: the
 * words an app says about it. This package carries no Spanish copy and no
 * app-specific rejection codes on purpose — each app maps `RegistryRevert` onto
 * its own vocabulary, because the same revert is a verdict for a pharmacy
 * counter, a terminal message for the CLI and a form error for the doctor.
 *
 * Unlike @recetas/shared, this package depends on viem deliberately. That is
 * the whole distinction between the two.
 */
export * from './registry-abi';
export * from './registry-errors';
export * from './viem-chain';
export * from './envelope-payload';
export * from './eip712';
