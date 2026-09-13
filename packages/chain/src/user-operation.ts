import {
  concatHex,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  numberToHex,
  size,
  slice,
} from 'viem';
import type { Address, Bytes32, Hex } from '@recetas/shared';
import { ENTRY_POINT_V07_ADDRESS, entryPointV07Abi } from './entry-point-abi';

/**
 * The ERC-4337 v0.7 wire format: how a `UserOperation` is packed, how the
 * EntryPoint hashes it, and what it costs.
 *
 * WHY THIS IS IN `@recetas/chain` AND NOT IN THE RELAYER. Two consumers need
 * byte-identical answers from it and they run in different processes:
 *
 *   - THE RELAYER (`services/api`) packs the operation, computes its hash and
 *     submits it.
 *   - THE DOCTOR'S APP needs the same `userOpHash`, because that hash is the
 *     `challenge` the authenticator signs (`apps/doctor/src/ports/passkey.port.ts`).
 *     If the two ever disagree by one byte the assertion verifies against a
 *     digest the EntryPoint never computed, and ERC-4337 reports that as
 *     `SIG_VALIDATION_FAILED` — one bit, no field name, no explanation.
 *
 * That is exactly the situation this package was created for; its header names
 * "decoding, plumbing and wire formats: the things where two copies can
 * silently disagree about what the chain said".
 *
 * WHAT v0.7 CHANGED, AND WHY IT IS THE PART THAT BREAKS SILENTLY. Three fields
 * are no longer what they look like:
 *
 *   `accountGasLimits` = verificationGasLimit (high 16 bytes) || callGasLimit (low 16)
 *   `gasFees`          = maxPriorityFeePerGas (high 16 bytes) || maxFeePerGas (low 16)
 *   `paymasterAndData` = paymaster (20) || paymasterVerificationGasLimit (16)
 *                        || paymasterPostOpGasLimit (16) || data
 *
 * Swap the halves of either packed word and the operation is still well-formed
 * ABI. It reaches the EntryPoint, fails, and comes back as an `AA` code that
 * names no field. `user-operation.test.ts` pins every one of these layouts.
 *
 * THIS MODULE IS PURE. It does no I/O, holds no key and knows no policy. What
 * the gas limits should BE is a relayer decision and lives with the relayer;
 * what a gas limit COSTS is arithmetic and lives here.
 */

/** The 128-bit ceiling both halves of a packed word have to fit under. */
const UINT128_MAX = (1n << 128n) - 1n;

/** `paymasterAndData`'s fixed header: 20 + 16 + 16. */
export const PAYMASTER_DATA_OFFSET = 52;

/** A malformed or impossible operation. Never a chain error. */
export class UserOperationEncodingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserOperationEncodingError';
  }
}

/**
 * The three paymaster fields v0.7 parses out of `paymasterAndData`.
 *
 * `PrescriptionPaymaster` reads no `data` at all — its policy is derived
 * entirely from the operation — so `data` is optional and defaults to empty.
 * The field is kept because the encoding has it and a second paymaster might.
 */
export interface PaymasterFields {
  address: Address;
  /** Gas for `validatePaymasterUserOp`. */
  verificationGasLimit: bigint;
  /**
   * Gas for `postOp`.
   *
   * Zero is correct for `PrescriptionPaymaster`, which returns an empty context
   * so v0.7 never calls `postOp` at all — its own docblock argues why. The
   * EntryPoint still counts this field into the required prefund and refunds
   * what is not spent.
   */
  postOpGasLimit: bigint;
  data?: Hex;
}

/**
 * An operation before it is packed: every field as the number it actually is.
 *
 * This is the shape humans and tests reason about. `packUserOperation` turns it
 * into the shape the EntryPoint reads, and nothing else should construct that
 * shape by hand.
 */
export interface UserOperationDraft {
  sender: Address;
  nonce: bigint;
  /**
   * `factory (20 bytes) || factoryCalldata`, or `0x` for an account that
   * already exists.
   *
   * THE COUNTERFACTUAL CASE IS THE POINT. A doctor's account does not exist
   * until its first operation; the EntryPoint deploys it from this field as
   * part of that operation, paid for by the paymaster, and the doctor never
   * sends a transaction. See `encodeInitCode`.
   */
  initCode: Hex;
  /** `execute(address,uint256,bytes)` against the registry. Nothing else. */
  callData: Hex;
  /**
   * Gas for validation — INCLUDING ACCOUNT DEPLOYMENT in v0.7, which removed
   * v0.6's separate field for it. An operation carrying `initCode` therefore
   * needs a limit that covers the factory too.
   */
  verificationGasLimit: bigint;
  callGasLimit: bigint;
  preVerificationGas: bigint;
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
  /** Absent means the sender pays its own gas. */
  paymaster?: PaymasterFields | undefined;
  /**
   * The ABI-encoded `WebAuthn.Assertion`.
   *
   * NOT part of `userOpHash` — verified against the live EntryPoint, see
   * `user-operation.test.ts`. That is what makes signing possible at all: the
   * hash has to exist before the signature does.
   */
  signature: Hex;
}

/**
 * The nine fields as EntryPoint v0.7 receives them.
 *
 * A `type` AND NOT AN `interface`, DELIBERATELY, and it has to stay one. viem
 * types a struct argument as a mapped type, and TypeScript gives a type alias
 * an implicit index signature while an interface gets none — so an interface
 * with these exact nine fields fails to match, and it fails by collapsing the
 * expected argument to `never`. The compiler then says "Type
 * 'PackedUserOperation' is not assignable to type 'never'", which names neither
 * the field nor the reason. Measured: switching this one keyword is the whole
 * difference between `readContract({ functionName: 'getUserOpHash' })`
 * compiling and not.
 */
export type PackedUserOperation = {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  accountGasLimits: Bytes32;
  preVerificationGas: bigint;
  gasFees: Bytes32;
  paymasterAndData: Hex;
  signature: Hex;
};

function requireUint128(value: bigint, field: string): void {
  if (value < 0n || value > UINT128_MAX) {
    throw new UserOperationEncodingError(`${field} does not fit in 128 bits: ${value}`);
  }
}

/**
 * Two `uint128` into one `bytes32`, high half first.
 *
 * The whole v0.7 packing reduces to this function and to remembering which
 * value is the high half. Both callers below name their arguments so the
 * question is answered at the call site rather than at the definition.
 */
export function packUint128Pair(high: bigint, low: bigint): Bytes32 {
  requireUint128(high, 'high half');
  requireUint128(low, 'low half');

  return `0x${((high << 128n) | low).toString(16).padStart(64, '0')}` as Bytes32;
}

/** The inverse, so a test can read back what it wrote. */
export function unpackUint128Pair(word: Bytes32): { high: bigint; low: bigint } {
  if (size(word) !== 32) {
    throw new UserOperationEncodingError(`a packed word is 32 bytes; this one is ${size(word)}`);
  }

  const value = BigInt(word);

  return { high: value >> 128n, low: value & UINT128_MAX };
}

/**
 * `verificationGasLimit` HIGH, `callGasLimit` LOW.
 *
 * Getting this round the wrong way is the single most expensive mistake in the
 * v0.7 migration, because the operation is still valid ABI: a 450k validation
 * budget becomes a 450k call budget and the account runs out of gas while
 * checking a signature that was perfectly good.
 */
export function packAccountGasLimits(limits: {
  verificationGasLimit: bigint;
  callGasLimit: bigint;
}): Bytes32 {
  return packUint128Pair(limits.verificationGasLimit, limits.callGasLimit);
}

export function unpackAccountGasLimits(word: Bytes32): {
  verificationGasLimit: bigint;
  callGasLimit: bigint;
} {
  const { high, low } = unpackUint128Pair(word);

  return { verificationGasLimit: high, callGasLimit: low };
}

/**
 * `maxPriorityFeePerGas` HIGH, `maxFeePerGas` LOW.
 *
 * NOTE THE ASYMMETRY WITH `accountGasLimits`, which is a genuine trap: there the
 * high half is the larger budget, here the high half is the SMALLER fee. The
 * order is the EntryPoint's, not a convention worth rationalising.
 */
export function packGasFees(fees: {
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
}): Bytes32 {
  return packUint128Pair(fees.maxPriorityFeePerGas, fees.maxFeePerGas);
}

export function unpackGasFees(word: Bytes32): {
  maxPriorityFeePerGas: bigint;
  maxFeePerGas: bigint;
} {
  const { high, low } = unpackUint128Pair(word);

  return { maxPriorityFeePerGas: high, maxFeePerGas: low };
}

/**
 * `paymaster (20) || paymasterVerificationGasLimit (16) || paymasterPostOpGasLimit (16) || data`.
 *
 * v0.6 had no layout at all here — it was a blob every paymaster sliced at its
 * own offsets — and v0.7 parsing it into named fields is one of the reasons
 * `PasskeyAccount.sol` chose v0.7. The price is that a client which still
 * writes the v0.6 shape (bare address, or address followed by data) produces a
 * `paymasterAndData` the EntryPoint reads as a 52-byte header, silently taking
 * the first 32 bytes of the data as two gas limits.
 */
export function encodePaymasterAndData(paymaster: PaymasterFields | undefined): Hex {
  if (paymaster === undefined) {
    return '0x';
  }

  requireUint128(paymaster.verificationGasLimit, 'paymasterVerificationGasLimit');
  requireUint128(paymaster.postOpGasLimit, 'paymasterPostOpGasLimit');

  if (size(paymaster.address) !== 20) {
    throw new UserOperationEncodingError(
      `a paymaster address is 20 bytes; this one is ${size(paymaster.address)}`,
    );
  }

  return concatHex([
    paymaster.address,
    numberToHex(paymaster.verificationGasLimit, { size: 16 }),
    numberToHex(paymaster.postOpGasLimit, { size: 16 }),
    paymaster.data ?? '0x',
  ]);
}

/**
 * The inverse, and it REFUSES A TRUNCATED HEADER rather than guessing.
 *
 * A `paymasterAndData` of between 1 and 51 bytes is the v0.6 shape, or a
 * client that forgot the two gas limits. Both produce an operation the
 * EntryPoint rejects; returning a half-filled object here would move the
 * failure one layer further from its cause.
 */
export function decodePaymasterAndData(value: Hex): PaymasterFields | undefined {
  const length = size(value);

  if (length === 0) {
    return undefined;
  }

  if (length < PAYMASTER_DATA_OFFSET) {
    throw new UserOperationEncodingError(
      `paymasterAndData is ${length} bytes: too short for the v0.7 header ` +
        `(${PAYMASTER_DATA_OFFSET} bytes of paymaster, verification limit and postOp limit)`,
    );
  }

  return {
    address: slice(value, 0, 20) as Address,
    verificationGasLimit: BigInt(slice(value, 20, 36)),
    postOpGasLimit: BigInt(slice(value, 36, PAYMASTER_DATA_OFFSET)),
    data: length === PAYMASTER_DATA_OFFSET ? '0x' : slice(value, PAYMASTER_DATA_OFFSET),
  };
}

/**
 * `factory (20 bytes) || createAccount(publicKeyX, publicKeyY)`.
 *
 * WHAT THE FIRST OPERATION IS. The account address is a CREATE2 commitment to
 * the passkey (`PasskeyAccountFactory.getAddress`), so the credential authority
 * can attest to it while no code exists there. The first operation carries this
 * field, the EntryPoint deploys the account inside it, and the paymaster pays.
 *
 * AND WHAT THAT FIRST OPERATION ACTUALLY DOES: `registerCredential(uid)`, never
 * `issue`. That is not an ordering preference, it is the only call a brand-new
 * account can make — `PrescriptionPaymaster._requireAccredited` sponsors an
 * account with no registered credential for exactly one thing, a
 * `registerCredential(uid)` whose uid is already a live credential issued to
 * it. An `issue` as the first operation is refused with `NotAccredited` before
 * it ever reaches the registry.
 */
export function encodeInitCode(factory: Address, publicKeyX: bigint, publicKeyY: bigint): Hex {
  return concatHex([
    factory,
    encodeFunctionData({
      abi: [
        {
          type: 'function',
          name: 'createAccount',
          stateMutability: 'nonpayable',
          inputs: [
            { name: 'publicKeyX', type: 'uint256' },
            { name: 'publicKeyY', type: 'uint256' },
          ],
          outputs: [{ name: '', type: 'address' }],
        },
      ] as const,
      functionName: 'createAccount',
      args: [publicKeyX, publicKeyY],
    }),
  ]);
}

/** A draft as the EntryPoint reads it. The only way to build the packed shape. */
export function packUserOperation(draft: UserOperationDraft): PackedUserOperation {
  return {
    sender: draft.sender,
    nonce: draft.nonce,
    initCode: draft.initCode,
    callData: draft.callData,
    accountGasLimits: packAccountGasLimits(draft),
    preVerificationGas: draft.preVerificationGas,
    gasFees: packGasFees(draft),
    paymasterAndData: encodePaymasterAndData(draft.paymaster),
    signature: draft.signature,
  };
}

/**
 * `userOpHash`, computed exactly as EntryPoint v0.7 computes it.
 *
 * WHY THIS IS REIMPLEMENTED AT ALL, given the EntryPoint exposes
 * `getUserOpHash` as a view. Because the doctor's authenticator has to be handed
 * the challenge, and a round trip to an RPC in the middle of a WebAuthn
 * ceremony is a round trip that can fail, hang, or answer about a different
 * chain. The hash is also needed in tests, in the browser, and offline.
 *
 * WHY THAT IS SAFE HERE AND NOT IN GENERAL: because the reimplementation is
 * CHECKED against the live contract. `user-operation.test.ts` asserts these
 * exact bytes against three answers taken from
 * 0x0000000071727De22E5E9d8BAf0edAc6f37da032 on Fuji, and
 * `entry-point-hash.live.test.ts` re-asks the contract on demand. A local digest
 * that is never compared with the thing it imitates is a guess with good
 * manners.
 *
 * NOTE WHAT IS NOT IN IT: `signature`. The hash covers the operation, the
 * EntryPoint's own address and the chain id — which is what makes a signature
 * un-replayable onto another chain, another EntryPoint or another operation —
 * and it cannot cover the signature, because the signature is over it.
 */
export function getUserOpHash(params: {
  userOp: PackedUserOperation;
  entryPoint?: Address;
  chainId: number;
}): Bytes32 {
  const { userOp } = params;
  const entryPoint = params.entryPoint ?? ENTRY_POINT_V07_ADDRESS;

  const overOperation = keccak256(
    encodeAbiParameters(
      [
        { type: 'address' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'bytes32' },
        { type: 'bytes32' },
      ],
      [
        userOp.sender,
        userOp.nonce,
        keccak256(userOp.initCode),
        keccak256(userOp.callData),
        userOp.accountGasLimits,
        userOp.preVerificationGas,
        userOp.gasFees,
        keccak256(userOp.paymasterAndData),
      ],
    ),
  );

  return keccak256(
    encodeAbiParameters([{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }], [
      overOperation,
      entryPoint,
      BigInt(params.chainId),
    ]),
  );
}

/**
 * What the EntryPoint will demand up front, and therefore what the paymaster is
 * asked to risk.
 *
 * This is `_getRequiredPrefund` from v0.7, and it is the number
 * `PrescriptionPaymaster.validatePaymasterUserOp` receives as `maxCost` and
 * compares against `maxCostPerOp`. Computing it locally is what lets the
 * relayer refuse an over-budget operation with a sentence instead of letting it
 * come back as `AA33 reverted` wrapping `CostNotSponsored`.
 */
export function requiredGas(draft: UserOperationDraft): bigint {
  return (
    draft.verificationGasLimit +
    draft.callGasLimit +
    draft.preVerificationGas +
    (draft.paymaster?.verificationGasLimit ?? 0n) +
    (draft.paymaster?.postOpGasLimit ?? 0n)
  );
}

export function requiredPrefund(draft: UserOperationDraft): bigint {
  return requiredGas(draft) * draft.maxFeePerGas;
}

/** The calldata of the transaction this operation travels in. */
export function encodeHandleOps(ops: PackedUserOperation[], beneficiary: Address): Hex {
  return encodeFunctionData({
    abi: entryPointV07Abi,
    functionName: 'handleOps',
    args: [ops, beneficiary],
  });
}

/** EIP-2028: 16 gas per non-zero calldata byte, 4 per zero byte. */
const CALLDATA_GAS_NON_ZERO = 16n;
const CALLDATA_GAS_ZERO = 4n;

/** The 21000 every transaction pays. Attributable in full: one op per transaction. */
const TRANSACTION_BASE_GAS = 21_000n;

/**
 * What `handleOps` spends around one operation that `preVerificationGas` has to
 * refund: the bundle loop, the `UserOperationEvent`, the deposit bookkeeping
 * and the transfer to the beneficiary.
 *
 * An ESTIMATE, and labelled as one. It is the only figure in this file that is
 * not either measured or dictated by the EVM, and it is deliberately generous:
 * `preVerificationGas` that is too low makes the EntryPoint refuse the
 * operation outright, while `preVerificationGas` that is too high is refunded —
 * it only inflates the prefund the paymaster is asked to reserve.
 */
const ENTRY_POINT_OVERHEAD_GAS = 20_000n;

function calldataGas(data: Hex): bigint {
  const bytes = data.slice(2);
  let total = 0n;

  for (let i = 0; i < bytes.length; i += 2) {
    total += bytes.slice(i, i + 2) === '00' ? CALLDATA_GAS_ZERO : CALLDATA_GAS_NON_ZERO;
  }

  return total;
}

/**
 * `preVerificationGas` for a single-operation bundle.
 *
 * WHY IT IS COMPUTED AND NOT A CONSTANT. It is the part of the transaction's
 * cost the EntryPoint cannot measure from inside itself — it is already paid by
 * the time the code runs — so it has to be predicted from the calldata. Its
 * dominant term is the operation's own size, and the operation's size is
 * dominated by the 512-byte WebAuthn envelope in `signature`. A constant would
 * be wrong for the first operation (which also carries `initCode`) in the
 * direction that makes it fail.
 *
 * THE SIGNATURE MUST ALREADY BE THE RIGHT SIZE when this is called. At the
 * moment the relayer sizes gas, the real assertion does not exist yet — the
 * doctor has not touched the sensor — so the draft carries
 * `PLACEHOLDER_ASSERTION_SIGNATURE`, whose length and zero-byte distribution
 * stand in for the real one. Estimating against an empty signature and then
 * signing a 512-byte envelope is a documented way to produce `AA40 over
 * verificationGasLimit`'s less famous cousin, an operation that runs out of
 * calldata budget.
 *
 * THE TWO PASSES. `preVerificationGas` is itself a field of the calldata being
 * measured, so the first pass measures with a zero in that slot and the second
 * measures with the answer. The difference is at most sixteen bytes of
 * calldata; the second pass is the fixed point in every case this project
 * produces, and `user-operation.test.ts` pins that.
 */
export function estimatePreVerificationGas(params: {
  draft: UserOperationDraft;
  beneficiary: Address;
}): bigint {
  const estimate = (preVerificationGas: bigint): bigint => {
    const packed = packUserOperation({ ...params.draft, preVerificationGas });

    return (
      TRANSACTION_BASE_GAS +
      ENTRY_POINT_OVERHEAD_GAS +
      calldataGas(encodeHandleOps([packed], params.beneficiary))
    );
  };

  return estimate(estimate(0n));
}

/**
 * A stand-in for the `WebAuthn.Assertion` the doctor has not produced yet.
 *
 * IT IS NOT A DUMMY THAT ANYTHING WILL ACCEPT — it is refused by
 * `WebAuthn.check` like any other malformed envelope, and that is fine, because
 * it is never submitted. Its only job is to have the SIZE and roughly the
 * zero-byte density of the real thing, so that `estimatePreVerificationGas`
 * answers about the operation that will actually be sent.
 *
 * The shape comes from `contracts/src/WebAuthn.sol`: 37 bytes of
 * `authenticatorData`, a 136-byte `clientDataJSON`, two offsets and two 256-bit
 * curve scalars, which the ABI encoder lays out as the ~512 bytes that docblock
 * quotes. `apps/doctor` has a test asserting that a REAL envelope is no longer
 * than this, which is the direction that matters.
 */
export const PLACEHOLDER_ASSERTION_SIGNATURE: Hex = encodeAbiParameters(
  [
    {
      type: 'tuple',
      components: [
        { name: 'authenticatorData', type: 'bytes' },
        { name: 'clientDataJSON', type: 'bytes' },
        { name: 'challengeIndex', type: 'uint256' },
        { name: 'typeIndex', type: 'uint256' },
        { name: 'r', type: 'uint256' },
        { name: 's', type: 'uint256' },
      ],
    },
  ] as const,
  [
    {
      authenticatorData: `0x${'ab'.repeat(37)}`,
      clientDataJSON: `0x${'cd'.repeat(136)}`,
      challengeIndex: 23n,
      typeIndex: 1n,
      r: (1n << 255n) - 1n,
      s: (1n << 254n) - 1n,
    },
  ],
);
