/**
 * ABI of `PrescriptionRegistry`, transcribed from
 * contracts/src/IPrescriptionRegistry.sol.
 *
 * SINGLE SOURCE. This file used to exist twice, byte for byte, in
 * apps/cli/src/registry-abi.ts and
 * apps/pharmacy/src/infrastructure/chain/registry-abi.ts. Review finding
 * read-001 (lineage review-fbc6fee420beae2b) asked for one copy: a new
 * Solidity custom error added to one copy and forgotten in the other is a
 * silent divergence nothing catches. The pharmacy copy already carried a TODO
 * to promote it to a package once a third consumer appeared, and the doctor app
 * is that third consumer.
 *
 * It lives here rather than in @recetas/shared because that package depends
 * only on zod and must stay usable without viem; this one is the chain-facing
 * package and depends on viem deliberately.
 *
 * It is written as a `const` instead of importing the Foundry artefact so every
 * consumer stays runnable without a compiled `contracts/out` tree, and so viem
 * can infer argument and error types statically.
 *
 * The custom errors are part of the ABI on purpose: decoding them is what lets
 * the pharmacy say "already dispensed on X by Y" instead of "transaction
 * reverted" (docs/04-smart-contracts.md). The credential errors carry the same
 * duty: a rejected accreditation must name which of the five checks failed.
 *
 * A prior review verified this transcription field by field against the
 * Solidity source; registry-abi.test.ts now re-checks it on every run by
 * parsing contracts/src/IPrescriptionRegistry.sol.
 */
export const prescriptionRegistryAbi = [
  {
    type: 'function',
    name: 'issue',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'contentHash', type: 'bytes32' },
      { name: 'patientCommitment', type: 'bytes32' },
      { name: 'expiresAt', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'registerCredential',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'uid', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'credentialOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: 'uid', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'eas',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'practitionerSchema',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'pharmacySchema',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  {
    type: 'function',
    name: 'issuerAuthority',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'dispense',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'contentHash', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancel',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'contentHash', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'verify',
    stateMutability: 'view',
    inputs: [{ name: 'contentHash', type: 'bytes32' }],
    outputs: [
      { name: 'status', type: 'uint8' },
      { name: 'dispensable', type: 'bool' },
      { name: 'prescriber', type: 'address' },
      { name: 'expiresAt', type: 'uint64' },
    ],
  },
  {
    type: 'function',
    name: 'getPrescription',
    stateMutability: 'view',
    inputs: [{ name: 'contentHash', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'prescriber', type: 'address' },
          { name: 'patientCommitment', type: 'bytes32' },
          { name: 'issuedAt', type: 'uint64' },
          { name: 'expiresAt', type: 'uint64' },
          { name: 'dispensedBy', type: 'address' },
          { name: 'dispensedAt', type: 'uint64' },
          { name: 'status', type: 'uint8' },
        ],
      },
    ],
  },
  {
    type: 'event',
    name: 'PrescriptionIssued',
    inputs: [
      { name: 'contentHash', type: 'bytes32', indexed: true },
      { name: 'prescriber', type: 'address', indexed: true },
      { name: 'patientCommitment', type: 'bytes32', indexed: false },
      { name: 'expiresAt', type: 'uint64', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'PrescriptionDispensed',
    inputs: [
      { name: 'contentHash', type: 'bytes32', indexed: true },
      { name: 'pharmacy', type: 'address', indexed: true },
      { name: 'dispensedAt', type: 'uint64', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'CredentialRegistered',
    inputs: [
      { name: 'account', type: 'address', indexed: true },
      { name: 'uid', type: 'bytes32', indexed: true },
      { name: 'schema', type: 'bytes32', indexed: true },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'PrescriptionCancelled',
    inputs: [
      { name: 'contentHash', type: 'bytes32', indexed: true },
      { name: 'prescriber', type: 'address', indexed: true },
    ],
    anonymous: false,
  },
  { type: 'error', name: 'AlreadyIssued', inputs: [{ name: 'contentHash', type: 'bytes32' }] },
  {
    type: 'error',
    name: 'UnknownPrescription',
    inputs: [{ name: 'contentHash', type: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'AlreadyDispensed',
    inputs: [
      { name: 'contentHash', type: 'bytes32' },
      { name: 'dispensedBy', type: 'address' },
      { name: 'dispensedAt', type: 'uint64' },
    ],
  },
  {
    type: 'error',
    name: 'PrescriptionExpired',
    inputs: [
      { name: 'contentHash', type: 'bytes32' },
      { name: 'expiresAt', type: 'uint64' },
    ],
  },
  {
    type: 'error',
    name: 'PrescriptionCancelledError',
    inputs: [{ name: 'contentHash', type: 'bytes32' }],
  },
  {
    type: 'error',
    name: 'NotAccreditedPractitioner',
    inputs: [{ name: 'caller', type: 'address' }],
  },
  { type: 'error', name: 'NotAccreditedPharmacy', inputs: [{ name: 'caller', type: 'address' }] },
  {
    type: 'error',
    name: 'NotPrescriber',
    inputs: [
      { name: 'caller', type: 'address' },
      { name: 'prescriber', type: 'address' },
    ],
  },
  { type: 'error', name: 'InvalidExpiry', inputs: [{ name: 'expiresAt', type: 'uint64' }] },
  { type: 'error', name: 'InvalidCredentialUid', inputs: [] },
  { type: 'error', name: 'CredentialNotFound', inputs: [{ name: 'uid', type: 'bytes32' }] },
  {
    type: 'error',
    name: 'CredentialNotForCaller',
    inputs: [
      { name: 'caller', type: 'address' },
      { name: 'recipient', type: 'address' },
    ],
  },
  {
    type: 'error',
    name: 'CredentialWrongIssuer',
    inputs: [
      { name: 'attester', type: 'address' },
      { name: 'expectedIssuer', type: 'address' },
    ],
  },
  { type: 'error', name: 'CredentialUnknownSchema', inputs: [{ name: 'schema', type: 'bytes32' }] },
  {
    type: 'error',
    name: 'CredentialRevoked',
    inputs: [
      { name: 'uid', type: 'bytes32' },
      { name: 'revocationTime', type: 'uint64' },
    ],
  },
  {
    type: 'error',
    name: 'CredentialExpired',
    inputs: [
      { name: 'uid', type: 'bytes32' },
      { name: 'expirationTime', type: 'uint64' },
    ],
  },
] as const;
