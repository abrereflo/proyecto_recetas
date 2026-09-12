/**
 * ABI of `PrescriptionRegistry`.
 *
 * The literal used to live here, byte-identical to apps/cli's copy, under a
 * TODO to promote it to a package once a third consumer appeared. The doctor
 * app is that consumer, so it now lives in @recetas/chain and review finding
 * read-001 (lineage review-fbc6fee420beae2b) is closed.
 *
 * The re-export stays because this is the pharmacy's chain adapter layer: every
 * chain-facing module of this app, and the tests that encode revert data for
 * them, keep importing the ABI from one place inside the app.
 */
export { prescriptionRegistryAbi } from '@recetas/chain';
