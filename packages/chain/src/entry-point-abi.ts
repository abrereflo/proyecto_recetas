/**
 * The part of EntryPoint v0.7 this project consumes, transcribed from
 * eth-infinitism's `account-abstraction` v0.7.
 *
 * WHY A HAND-WRITTEN SUBSET AND NOT THE PACKAGE. The same argument
 * `contracts/src/IAccount.sol` already makes for the Solidity side: the
 * `account-abstraction` package brings a `BaseAccount`, a `SenderCreator`,
 * stake management and a second compiler pin with it, and this project needs
 * one struct, four functions and three errors. It is written as a `const`
 * rather than read out of a build artefact so every consumer stays runnable
 * without a compiled tree, exactly like `registry-abi.ts`.
 *
 * THE ORDER AND THE TYPES MUST MATCH THE DEPLOYED CONTRACT EXACTLY. A reordered
 * or resized field does not fail loudly: it encodes into the wrong slot and the
 * EntryPoint answers with an `AA` code that names no field. That is the whole
 * reason `user-operation.test.ts` pins the encoding against hashes taken from
 * the live contract rather than against this file's own opinion of itself.
 *
 * VERIFIED ON CHAIN. `getUserOpHash` was called against
 * 0x0000000071727De22E5E9d8BAf0edAc6f37da032 on Avalanche Fuji (chain 43113) on
 * 13/09/2026 with three different operations; all three answers are recorded as
 * fixtures in `user-operation.test.ts`.
 */

import type { Address } from '@recetas/shared';

/**
 * EntryPoint v0.7, canonical and identical on every chain that has it.
 *
 * Live on Avalanche Fuji with 16035 bytes of code (docs/16-plan-de-ejecucion.md).
 * `contracts/src/PasskeyAccount.sol` argues at length why v0.7 rather than v0.6
 * or v0.8; that decision is not re-litigated here, it is consumed.
 */
export const ENTRY_POINT_V07_ADDRESS = '0x0000000071727De22E5E9d8BAf0edAc6f37da032' as Address;

/**
 * `PackedUserOperation`, the nine fields the EntryPoint reads.
 *
 * Extracted as its own constant because both `handleOps` and `getUserOpHash`
 * take it, and two transcriptions of a struct are two chances to get one wrong.
 */
const packedUserOperationComponents = [
  { name: 'sender', type: 'address' },
  { name: 'nonce', type: 'uint256' },
  { name: 'initCode', type: 'bytes' },
  { name: 'callData', type: 'bytes' },
  { name: 'accountGasLimits', type: 'bytes32' },
  { name: 'preVerificationGas', type: 'uint256' },
  { name: 'gasFees', type: 'bytes32' },
  { name: 'paymasterAndData', type: 'bytes' },
  { name: 'signature', type: 'bytes' },
] as const;

export const entryPointV07Abi = [
  /**
   * THE FUNCTION THAT MAKES THIS PROJECT'S RELAYER POSSIBLE.
   *
   * It is `public` with no access control, so anyone may submit a bundle and be
   * paid the `beneficiary` share. That is why no commercial bundler is needed
   * and why `PrescriptionPaymaster` can break ERC-7562 without breaking
   * anything: ERC-7562 is a bundler mempool policy, and the EntryPoint does not
   * enforce it.
   */
  {
    type: 'function',
    name: 'handleOps',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'ops', type: 'tuple[]', components: packedUserOperationComponents },
      { name: 'beneficiary', type: 'address' },
    ],
    outputs: [],
  },
  /**
   * The digest the account's owner actually signs.
   *
   * THE MOST IMPORTANT VIEW IN THIS FILE. `user-operation.ts` recomputes this
   * hash locally — it has to, because the doctor's authenticator must be handed
   * the challenge before any round trip — but a local reimplementation of a
   * consensus-critical digest that is never checked against the thing it
   * imitates is a guess. This entry exists so the check can be made.
   */
  {
    type: 'function',
    name: 'getUserOpHash',
    stateMutability: 'view',
    inputs: [{ name: 'userOp', type: 'tuple', components: packedUserOperationComponents }],
    outputs: [{ name: '', type: 'bytes32' }],
  },
  /**
   * The next nonce for `sender` in a given 192-bit key space.
   *
   * This project uses key 0 exclusively: parallel nonce keys buy concurrent
   * operations from one account, and a doctor signs one prescription at a time.
   */
  {
    type: 'function',
    name: 'getNonce',
    stateMutability: 'view',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'key', type: 'uint192' },
    ],
    outputs: [{ name: 'nonce', type: 'uint256' }],
  },
  /** What a paymaster has left to sponsor with. Read before submitting. */
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  /**
   * `FailedOp(opIndex, reason)` — the fixed-string refusal.
   *
   * `reason` is one of the `AAxx` strings and carries no arguments. Decoding it
   * is the difference between telling the doctor "AA33 reverted" and telling
   * them nothing at all.
   */
  {
    type: 'error',
    name: 'FailedOp',
    inputs: [
      { name: 'opIndex', type: 'uint256' },
      { name: 'reason', type: 'string' },
    ],
  },
  /**
   * `FailedOpWithRevert(opIndex, reason, inner)` — the one that carries the
   * paymaster's own error, selector and arguments intact.
   *
   * This is the channel `PrescriptionPaymaster` deliberately chose (Fase 5 item
   * 8): `inner` decodes to `SponsorshipExhausted(account, used, limit,
   * windowEndsAt)`, which is what lets a screen say when sponsorship comes back
   * rather than only that it is gone.
   */
  {
    type: 'error',
    name: 'FailedOpWithRevert',
    inputs: [
      { name: 'opIndex', type: 'uint256' },
      { name: 'reason', type: 'string' },
      { name: 'inner', type: 'bytes' },
    ],
  },
  /** A `postOp` that reverted. Unreachable here: the paymaster returns no context. */
  {
    type: 'error',
    name: 'PostOpReverted',
    inputs: [{ name: 'returnData', type: 'bytes' }],
  },
] as const;
