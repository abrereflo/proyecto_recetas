import { decodeErrorResult, type Hex } from 'viem';
import { decodeRegistryError, entryPointV07Abi } from '@recetas/chain';

/**
 * Turning a refused `handleOps` back into a sentence.
 *
 * WHY THIS FILE EXISTS. EntryPoint v0.7 has two ways to refuse and only one of
 * them says anything:
 *
 *   `FailedOp(opIndex, reason)` — `reason` is a fixed `AAxx` string with no
 *   arguments. "AA34 signature error". "AA32 paymaster expired or not due".
 *
 *   `FailedOpWithRevert(opIndex, reason, inner)` — `reason` is "AA33 reverted"
 *   and `inner` is the paymaster's OWN error, selector and arguments intact.
 *
 * `PrescriptionPaymaster` reverts for every one of its rules precisely so the
 * second shape is the one that happens, and Fase 5 item 8 — "mensaje de rechazo
 * por límite de patrocinio agotado" — is only reachable if somebody decodes
 * `inner`. Nobody was. This is that somebody.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: pick the words. Following the rule
 * `@recetas/chain`'s own header states, this returns the error and its
 * arguments and never a Spanish sentence — the same `SponsorshipExhausted` is a
 * banner on a doctor's screen, a line in a relayer log and a row in an
 * operator's dashboard, and those are three different sentences.
 */

/**
 * `PrescriptionPaymaster`'s custom errors, transcribed from
 * `contracts/src/PrescriptionPaymaster.sol`.
 *
 * Kept here rather than in `@recetas/chain` for now because this service is the
 * only consumer: the doctor's app learns about an exhausted quota from
 * `sponsorshipOf`, a free `eth_call`, BEFORE asking for a fingerprint — which
 * is what that view exists for. If a second consumer appears, this moves, for
 * the same reason `registry-abi.ts` moved.
 */
export const prescriptionPaymasterErrorsAbi = [
  { type: 'error', name: 'NotEntryPoint', inputs: [{ name: 'caller', type: 'address' }] },
  {
    type: 'error',
    name: 'NotTheFunder',
    inputs: [
      { name: 'caller', type: 'address' },
      { name: 'funder', type: 'address' },
    ],
  },
  { type: 'error', name: 'UnsupportedCallData', inputs: [{ name: 'length', type: 'uint256' }] },
  { type: 'error', name: 'UnsupportedSelector', inputs: [{ name: 'selector', type: 'bytes4' }] },
  {
    type: 'error',
    name: 'TargetNotSponsored',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'registry', type: 'address' },
    ],
  },
  { type: 'error', name: 'ValueNotSponsored', inputs: [{ name: 'value', type: 'uint256' }] },
  { type: 'error', name: 'NotAccredited', inputs: [{ name: 'account', type: 'address' }] },
  {
    type: 'error',
    name: 'SponsorshipExhausted',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'used', type: 'uint32' },
      { name: 'limit', type: 'uint32' },
      { name: 'windowEndsAt', type: 'uint64' },
    ],
  },
  {
    type: 'error',
    name: 'CostNotSponsored',
    inputs: [
      { name: 'maxCost', type: 'uint256' },
      { name: 'allowed', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'InvalidPolicy', inputs: [] },
] as const;

/**
 * `PasskeyAccount`'s custom errors. Reachable from `handleOps` when `execute`
 * is pointed somewhere it may not go, or when the account is called by anything
 * that is not the EntryPoint.
 */
export const passkeyAccountErrorsAbi = [
  { type: 'error', name: 'NotEntryPoint', inputs: [{ name: 'caller', type: 'address' }] },
  { type: 'error', name: 'AssertionRejected', inputs: [{ name: 'reason', type: 'uint8' }] },
  {
    type: 'error',
    name: 'TargetNotAllowed',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'allowed', type: 'address' },
    ],
  },
  { type: 'error', name: 'ValueNotAllowed', inputs: [{ name: 'value', type: 'uint256' }] },
  {
    type: 'error',
    name: 'InvalidPublicKey',
    inputs: [
      { name: 'x', type: 'uint256' },
      { name: 'y', type: 'uint256' },
    ],
  },
] as const;

/** A named error with its arguments, or the raw bytes when nothing matched. */
export interface DecodedFailure {
  /** The `AAxx` string the EntryPoint reported, when there was one. */
  entryPointReason?: string;
  opIndex?: bigint;
  /** Which contract's vocabulary `name` belongs to. */
  source: 'entry-point' | 'paymaster' | 'account' | 'registry' | 'unknown';
  name?: string;
  args?: Record<string, unknown>;
  /** Always present, so nothing is ever lost in translation. */
  data?: Hex;
}

function namedArgs(abiArgs: readonly unknown[] | undefined, names: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  names.forEach((name, index) => {
    out[name] = abiArgs?.[index];
  });

  return out;
}

function tryDecode(
  abi: typeof prescriptionPaymasterErrorsAbi | typeof passkeyAccountErrorsAbi,
  data: Hex,
): { name: string; args: Record<string, unknown> } | undefined {
  try {
    const decoded = decodeErrorResult({ abi, data });
    const entry = abi.find((item) => item.name === decoded.errorName);

    return {
      name: decoded.errorName,
      args: namedArgs(decoded.args as readonly unknown[] | undefined, (entry?.inputs ?? []).map((i) => i.name)),
    };
  } catch {
    return undefined;
  }
}

/**
 * Decode the `inner` bytes of `FailedOpWithRevert`.
 *
 * THE ORDER MATTERS AND IT IS NOT ALPHABETICAL. The paymaster is tried first
 * because it is where validation refusals come from and because it is the only
 * source of `SponsorshipExhausted`. Then the account, then the registry — which
 * is last because a registry revert has already travelled through
 * `PasskeyAccount.execute`, which re-throws it verbatim exactly so that
 * `AlreadyDispensed(hash, who, when)` survives the trip.
 *
 * `NotEntryPoint(address)` exists in both the paymaster and the account with the
 * same selector, so a bare selector cannot distinguish them. It is attributed to
 * the paymaster, which is the one that can actually produce it during a
 * `handleOps` the EntryPoint itself drove; the argument is the same either way.
 */
export function decodeInnerFailure(data: Hex): DecodedFailure {
  const fromPaymaster = tryDecode(prescriptionPaymasterErrorsAbi, data);

  if (fromPaymaster !== undefined) {
    return { source: 'paymaster', ...fromPaymaster, data };
  }

  const fromAccount = tryDecode(passkeyAccountErrorsAbi, data);

  if (fromAccount !== undefined) {
    return { source: 'account', ...fromAccount, data };
  }

  const fromRegistry = decodeRegistryError({ data });

  if (fromRegistry !== undefined) {
    const { name, ...args } = fromRegistry as { name: string } & Record<string, unknown>;

    return { source: 'registry', name, args, data };
  }

  return { source: 'unknown', data };
}

/**
 * Decode whatever `handleOps` reverted with.
 *
 * Takes the revert data rather than a viem error object on purpose: this is a
 * pure function over bytes, which is what makes it testable without a node and
 * reusable from both the simulation path and the receipt path.
 */
export function decodeHandleOpsFailure(data: Hex | undefined): DecodedFailure {
  if (data === undefined || data === '0x') {
    return { source: 'unknown' };
  }

  let decoded;

  try {
    decoded = decodeErrorResult({ abi: entryPointV07Abi, data });
  } catch {
    // Not an EntryPoint error at all: an account or paymaster error that
    // reached the caller without being wrapped, which is what a plain
    // `eth_call` simulation of a view can produce.
    return decodeInnerFailure(data);
  }

  const args = (decoded.args ?? []) as readonly unknown[];

  if (decoded.errorName === 'FailedOpWithRevert') {
    const inner = args[2] as Hex | undefined;

    return {
      entryPointReason: args[1] as string,
      opIndex: args[0] as bigint,
      ...(inner === undefined ? { source: 'entry-point' as const } : decodeInnerFailure(inner)),
    };
  }

  if (decoded.errorName === 'FailedOp') {
    return {
      entryPointReason: args[1] as string,
      opIndex: args[0] as bigint,
      source: 'entry-point',
      name: 'FailedOp',
      data,
    };
  }

  return { source: 'entry-point', name: decoded.errorName, data };
}
