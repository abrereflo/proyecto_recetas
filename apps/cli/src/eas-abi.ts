/**
 * ABI of the EAS surface this CLI touches.
 *
 * Two halves, and the split matters.
 *
 * `easAbi` is the real thing: a single read, `getAttestation`, which is all the
 * registry itself uses. It works against the canonical EAS deployment on any
 * network.
 *
 * `mockEasAbi` adds the write side of contracts/test/mocks/MockEAS.sol, which
 * only exists on Anvil. Attesting and revoking are the credential authority's
 * job, performed from its multisig through the real EAS
 * (docs/02-roles-y-permisos.md); the CLI does it locally so the demo can show a
 * credential being withdrawn. `isMock` is the guard: no write is attempted
 * unless the contract admits to being the test double.
 */

const ATTESTATION_TUPLE = {
  name: '',
  type: 'tuple',
  components: [
    { name: 'uid', type: 'bytes32' },
    { name: 'schema', type: 'bytes32' },
    { name: 'time', type: 'uint64' },
    { name: 'expirationTime', type: 'uint64' },
    { name: 'revocationTime', type: 'uint64' },
    { name: 'refUID', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'attester', type: 'address' },
    { name: 'revocable', type: 'bool' },
    { name: 'data', type: 'bytes' },
  ],
} as const;

export const easAbi = [
  {
    type: 'function',
    name: 'getAttestation',
    stateMutability: 'view',
    inputs: [{ name: 'uid', type: 'bytes32' }],
    outputs: [ATTESTATION_TUPLE],
  },
] as const;

export const mockEasAbi = [
  ...easAbi,
  {
    type: 'function',
    name: 'isMock',
    stateMutability: 'pure',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'attestWithUid',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'uid', type: 'bytes32' },
      { name: 'schema', type: 'bytes32' },
      { name: 'recipient', type: 'address' },
      { name: 'attester', type: 'address' },
      { name: 'expirationTime', type: 'uint64' },
      { name: 'revocationTime', type: 'uint64' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revoke',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'uid', type: 'bytes32' }],
    outputs: [],
  },
] as const;
