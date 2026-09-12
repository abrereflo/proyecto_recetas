import {
  BaseError,
  ContractFunctionRevertedError,
  decodeErrorResult,
  type Address,
  type Hex,
} from 'viem';
import { prescriptionRegistryAbi } from './registry-abi';

/**
 * Decoding of `PrescriptionRegistry`'s custom errors (docs/04-smart-contracts.md).
 *
 * SINGLE SOURCE of the decoding pipeline. Review finding read-002 (lineage
 * review-fbc6fee420beae2b) found this control flow reimplemented independently
 * in `decodeRegistryError` (apps/cli) and `decodeRegistryRejection`
 * (apps/pharmacy): the `BaseError` walk, the cause-chain recursion over raw
 * revert data, the `decodeErrorResult` fallback and the defensive argument
 * readers were the same in both, so a new Solidity custom error could be mapped
 * in one app and silently missed in the other.
 *
 * What this module deliberately does NOT do is speak to anybody. The result is
 * structured and presentation-free: no Spanish copy, no rejection codes, no
 * headline/detail/action shape. That is the seam. Each app maps `RegistryRevert`
 * onto its own vocabulary — the pharmacy onto its `RejectionReason`, the CLI
 * onto its terminal messages — because the same revert is a verdict for the
 * counter in one app and a developer-facing failure in the other.
 */

/** The address a missing `address` argument decodes to. */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

/**
 * One decoded custom error of `PrescriptionRegistry`, with its arguments.
 *
 * The union is closed over the errors declared in
 * contracts/src/IPrescriptionRegistry.sol; registry-abi.test.ts asserts the ABI
 * and the Solidity source still agree, and registry-errors.test.ts asserts every
 * member decodes with its arguments.
 */
export type RegistryRevert =
  | { name: 'AlreadyIssued'; contentHash: Hex }
  | { name: 'UnknownPrescription'; contentHash: Hex }
  /** `dispensedBy` and `dispensedAt` are the whole point of this error. */
  | { name: 'AlreadyDispensed'; contentHash: Hex; dispensedBy: Address; dispensedAt: bigint }
  | { name: 'PrescriptionExpired'; contentHash: Hex; expiresAt: bigint }
  | { name: 'PrescriptionCancelledError'; contentHash: Hex }
  | { name: 'NotAccreditedPractitioner'; caller: Address }
  | { name: 'NotAccreditedPharmacy'; caller: Address }
  | { name: 'NotPrescriber'; caller: Address; prescriber: Address }
  | { name: 'InvalidExpiry'; expiresAt: bigint }
  | { name: 'InvalidCredentialUid' }
  | { name: 'CredentialNotFound'; uid: Hex }
  | { name: 'CredentialNotForCaller'; caller: Address; recipient: Address }
  | { name: 'CredentialWrongIssuer'; attester: Address; expectedIssuer: Address }
  | { name: 'CredentialUnknownSchema'; schema: Hex }
  | { name: 'CredentialRevoked'; uid: Hex; revocationTime: bigint }
  | { name: 'CredentialExpired'; uid: Hex; expirationTime: bigint };

export type RegistryRevertName = RegistryRevert['name'];

/**
 * A revert that was decoded but not recognised as one of the registry's own
 * errors.
 *
 * Kept as a separate, untyped shape so a caller that has to say something about
 * an unmodelled error still can, without that possibility leaking into
 * `RegistryRevert` and defeating its exhaustiveness.
 */
export interface RawRegistryRevert {
  errorName: string;
  args: readonly unknown[] | undefined;
}

function argAt(args: readonly unknown[] | undefined, index: number): unknown {
  return args === undefined ? undefined : args[index];
}

/** Defensive readers: a missing argument must not throw mid-verdict. */
function addressArg(args: readonly unknown[] | undefined, index: number): Address {
  const value = argAt(args, index);
  return typeof value === 'string' ? (value as Address) : ZERO_ADDRESS;
}

function timestampArg(args: readonly unknown[] | undefined, index: number): bigint {
  const value = argAt(args, index);
  return typeof value === 'bigint' ? value : 0n;
}

function bytes32Arg(args: readonly unknown[] | undefined, index: number): Hex {
  const value = argAt(args, index);
  return typeof value === 'string' ? (value as Hex) : '0x';
}

/**
 * Structures one already-decoded custom error, or returns `undefined` when the
 * name is not one the registry declares.
 */
export function toRegistryRevert(
  errorName: string,
  args: readonly unknown[] | undefined,
): RegistryRevert | undefined {
  switch (errorName) {
    case 'AlreadyIssued':
      return { name: errorName, contentHash: bytes32Arg(args, 0) };

    case 'UnknownPrescription':
      return { name: errorName, contentHash: bytes32Arg(args, 0) };

    case 'AlreadyDispensed':
      return {
        name: errorName,
        contentHash: bytes32Arg(args, 0),
        dispensedBy: addressArg(args, 1),
        dispensedAt: timestampArg(args, 2),
      };

    case 'PrescriptionExpired':
      return {
        name: errorName,
        contentHash: bytes32Arg(args, 0),
        expiresAt: timestampArg(args, 1),
      };

    case 'PrescriptionCancelledError':
      return { name: errorName, contentHash: bytes32Arg(args, 0) };

    case 'NotAccreditedPractitioner':
      return { name: errorName, caller: addressArg(args, 0) };

    case 'NotAccreditedPharmacy':
      return { name: errorName, caller: addressArg(args, 0) };

    case 'NotPrescriber':
      return {
        name: errorName,
        caller: addressArg(args, 0),
        prescriber: addressArg(args, 1),
      };

    case 'InvalidExpiry':
      return { name: errorName, expiresAt: timestampArg(args, 0) };

    case 'InvalidCredentialUid':
      return { name: errorName };

    case 'CredentialNotFound':
      return { name: errorName, uid: bytes32Arg(args, 0) };

    case 'CredentialNotForCaller':
      return {
        name: errorName,
        caller: addressArg(args, 0),
        recipient: addressArg(args, 1),
      };

    case 'CredentialWrongIssuer':
      return {
        name: errorName,
        attester: addressArg(args, 0),
        expectedIssuer: addressArg(args, 1),
      };

    case 'CredentialUnknownSchema':
      return { name: errorName, schema: bytes32Arg(args, 0) };

    case 'CredentialRevoked':
      return {
        name: errorName,
        uid: bytes32Arg(args, 0),
        revocationTime: timestampArg(args, 1),
      };

    case 'CredentialExpired':
      return {
        name: errorName,
        uid: bytes32Arg(args, 0),
        expirationTime: timestampArg(args, 1),
      };

    default:
      return undefined;
  }
}

/**
 * Pulls the error name and arguments out of whatever viem threw, without
 * interpreting them.
 *
 * Two paths are covered: the rich `ContractFunctionRevertedError` raised by
 * `simulateContract`, and a bare revert data blob, which is what some nodes
 * return when the estimation path is skipped. The blob is searched for down the
 * `cause` chain, because that is where a transport wraps it.
 */
export function decodeRegistryRevertData(error: unknown): RawRegistryRevert | undefined {
  if (error instanceof BaseError) {
    const reverted = error.walk((candidate) => candidate instanceof ContractFunctionRevertedError);

    if (reverted instanceof ContractFunctionRevertedError && reverted.data !== undefined) {
      return { errorName: reverted.data.errorName, args: reverted.data.args };
    }
  }

  const raw = rawRevertData(error);
  if (raw !== undefined) {
    try {
      const decoded = decodeErrorResult({ abi: prescriptionRegistryAbi, data: raw });
      return {
        errorName: decoded.errorName,
        args: decoded.args as readonly unknown[] | undefined,
      };
    } catch {
      return undefined;
    }
  }

  return undefined;
}

/**
 * Pulls a decoded, structured custom error out of whatever viem threw.
 *
 * Returns `undefined` for anything that is not a revert of an error this
 * registry declares, so a caller never invents a verdict out of a failure
 * nobody modelled.
 */
export function decodeRegistryError(error: unknown): RegistryRevert | undefined {
  const decoded = decodeRegistryRevertData(error);
  return decoded === undefined ? undefined : toRegistryRevert(decoded.errorName, decoded.args);
}

function rawRevertData(error: unknown): Hex | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  const candidate = (error as { data?: unknown }).data;
  if (typeof candidate === 'string' && candidate.startsWith('0x') && candidate.length >= 10) {
    return candidate as Hex;
  }

  const cause = (error as { cause?: unknown }).cause;
  return cause === undefined ? undefined : rawRevertData(cause);
}
