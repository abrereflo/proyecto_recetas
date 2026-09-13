import { ExecutionRevertedError, decodeFunctionData, slice, toFunctionSelector } from 'viem';
import {
  encodeInitCode,
  getUserOpHash,
  packUserOperation,
  prescriptionRegistryAbi,
  requiredGas,
  type PackedUserOperation,
  type UserOperationDraft,
} from '@recetas/chain';
import type { Address, Bytes32, Hex } from '@recetas/shared';
import type { RelayerConfig } from '../env';
import {
  GasPolicyError,
  PAYMASTER_POST_OP_GAS_LIMIT,
  PAYMASTER_VERIFICATION_GAS_LIMIT,
  assertWithinPolicy,
  sizeAccountGas,
  sizeFees,
  sizePreVerificationGas,
  type OperationShape,
} from './gas-policy';
import { decodeHandleOpsFailure, type DecodedFailure } from './failures';

/**
 * THE RELAYER. Fase 5 item 5: the thing that submits a doctor's signed
 * `UserOperation` so the doctor never holds AVAX.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THIS IS NOT A BUNDLER. Read this paragraph before describing it to anyone.
 *
 * It has NO MEMPOOL: an operation is submitted or refused, never held. It does
 * NO BUNDLING: one operation per transaction, always — `handleOps` takes an
 * array and this passes an array of one. It enforces NO ERC-7562: none of the
 * opcode bans, storage-access rules or staking requirements a bundler applies
 * to protect a shared mempool are checked here, because there is no shared
 * mempool to protect. It has NO REPUTATION SYSTEM, NO STAKE, and it does not
 * implement the `eth_sendUserOperation` JSON-RPC surface a bundler exposes.
 *
 * WHAT IT IS INSTEAD: a transaction sender with a policy. EntryPoint v0.7's
 * `handleOps(PackedUserOperation[], address payable beneficiary)` is `public`
 * with no access control, so anybody may submit; this service is the somebody
 * that does it on the doctor's behalf and pays the transaction fee.
 *
 * THAT IS WHY `PrescriptionPaymaster` CAN EXIST AT ALL. Its own header states
 * that it is NOT compatible with a public ERC-4337 bundler — it needs
 * `TIMESTAMP` during validation ([OP-011], which staking does not fix) and it
 * reads the registry's and EAS's storage ([STO-033]). Both are ERC-7562 rules,
 * ERC-7562 is bundler mempool policy, and the EntryPoint does not enforce it.
 * An operation that breaks those rules executes correctly when it is submitted
 * directly. This file is what "submitted directly" means.
 *
 * Calling this a bundler would be an overstatement of exactly the kind
 * docs/12-preguntas-de-jurado.md tells us not to make.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHAT AN OPEN ENDPOINT ACTUALLY EXPOSES — worked through the money, because
 * instinct gets this one backwards in both directions.
 *
 * THE INSTINCT THAT SAYS "IT IS FINE": the paymaster only pays for accredited
 * accounts calling the registry inside their window, with a `maxCostPerOp`
 * ceiling, so the spend is bounded at `opsPerWindow × maxCostPerOp` per account
 * per day. TRUE, AND IT IS ABOUT THE WRONG PURSE. That bound is on the
 * PAYMASTER'S DEPOSIT. It says nothing about this relayer's own balance.
 *
 * THE ACTUAL FLOW, in two cases:
 *
 *   THE OPERATION SUCCEEDS. The EntryPoint deducts `actualGasCost` from the
 *   paymaster's deposit and transfers it to `beneficiary`, which is this
 *   relayer. Roughly break-even: the relayer pays the transaction fee to the
 *   validators and is reimbursed for it, which is what `preVerificationGas`
 *   exists to cover. An attacker who gets a successful operation through has
 *   spent the paymaster's quota — which IS bounded — and cost the relayer
 *   approximately nothing.
 *
 *   THE OPERATION FAILS VALIDATION. `handleOps` REVERTS. The whole transaction
 *   reverts, so no transfer to `beneficiary` happens and NOTHING IS
 *   REIMBURSED — but the relayer has still paid the validators for the gas
 *   burned up to the revert. That cost falls entirely on the relayer's own
 *   AVAX, it is not capped by anything the paymaster does, and the attacker
 *   pays nothing at all.
 *
 * SO THE ANSWER IS: NO, THE MONEY FLOW DOES NOT BOUND THIS RELAYER'S SPEND. The
 * paymaster bounds the sponsorship; the failing path bypasses the paymaster
 * entirely and bills the relayer. An open endpoint with no limiting is a
 * faucet for draining the relayer key, one reverted transaction at a time.
 *
 * WHAT IS DONE ABOUT IT, in the order the defences apply:
 *
 *   1. SIMULATE FIRST, ALWAYS. Every submission is `eth_call`-ed against the
 *      EntryPoint before a transaction is signed. An operation that would
 *      revert is refused for free, and — because `FailedOpWithRevert` carries
 *      the paymaster's own error — the client gets `SponsorshipExhausted(...)`
 *      with its four arguments instead of a burned transaction. This converts
 *      almost the whole attack from "burns the relayer's AVAX" into "burns an
 *      RPC call".
 *
 *   2. RATE LIMIT ANYWAY, because (1) is not airtight. Simulation is a
 *      different block from inclusion: a quota consumed by another operation in
 *      between, a credential revoked one block later, or a base-fee move all
 *      produce an operation that simulates clean and reverts on chain. That
 *      residue is real, it is attacker-triggerable, and a limiter is what
 *      bounds it. `rate-limit.ts` does it per remote address AND per sender.
 *
 *   3. CAP THE TRANSACTION. The submission carries an explicit `gas` derived
 *      from the operation's own limits, so a single reverting call cannot burn
 *      a block's worth of the relayer's balance.
 *
 *   4. ONE PAYMASTER ONLY. An operation naming any other paymaster is refused.
 *      Without this the relayer would pay transaction fees to carry operations
 *      sponsored by strangers — all of the cost, none of the purpose.
 *
 * AND WHAT IS DELIBERATELY NOT DONE: THE ENDPOINT IS NOT AUTHENTICATED, and
 * that is a decision rather than an omission.
 *
 *   - THERE IS NOTHING TO AUTHENTICATE WITH. The caller is a doctor whose
 *     account DOES NOT EXIST YET — the whole point of the first operation is to
 *     deploy it. They hold a passkey and no other credential. A shared API key
 *     shipped to a browser SPA is a public string.
 *   - THE REAL ACCESS CONTROL IS ALREADY ON CHAIN AND IS STRONGER. The
 *     paymaster refuses anyone without a live EAS credential issued by
 *     `issuerAuthority`, re-read on every operation and never cached. An
 *     attacker who could authenticate to this endpoint still could not get one
 *     operation sponsored. Authentication here would gate who may ASK; the
 *     credential gates who may SUCCEED, and it is the second that matters.
 *   - SO THE THING WORTH PROTECTING IS THE RELAYER'S BALANCE, NOT THE
 *     OPERATION, and a rate limit protects a balance. Authentication would not.
 *
 * The honest residual risk, stated: a determined attacker can still consume
 * this relayer's rate-limit budget and make it simulate operations, and a
 * distributed one can spend some of its AVAX on reverts inside the limit. The
 * mitigation for that is operational — fund the relayer key with what a demo
 * needs and no more (docs/08: never a key holding real funds) — and `GET
 * /relayer` reports the balance so it is visible rather than discovered.
 */

/** Everything the relayer needs from a chain, as the narrowest shape that does the job. */
export interface RelayerChain {
  /** The relayer's own address. Public: it appears as `beneficiary` on chain. */
  readonly address: Address;
  getBalance(): Promise<bigint>;
  /** Zero for an account that has not been deployed yet. */
  getCodeSize(address: Address): Promise<number>;
  getNonce(sender: Address): Promise<bigint>;
  getFees(): Promise<{ baseFeePerGas: bigint; maxPriorityFeePerGas: bigint }>;
  /** `PasskeyAccountFactory.getAddress(x, y)`, the counterfactual address. */
  predictAccount(factory: Address, publicKeyX: bigint, publicKeyY: bigint): Promise<Address>;
  getPaymasterDeposit(paymaster: Address): Promise<bigint>;
  /**
   * Rejects when the operation would fail, with the node's answer intact: the
   * "execution reverted" code, and the revert bytes when there were any. Both
   * matter — `submit` reads the first to tell a verdict from an unreachable
   * node, and the second to name what was refused.
   */
  simulateHandleOps(userOp: PackedUserOperation): Promise<void>;
  sendHandleOps(userOp: PackedUserOperation, gas: bigint): Promise<Hex>;
}

/** A refusal this relayer makes, with a code a client can branch on. */
export class RelayerRefusal extends Error {
  constructor(
    readonly code:
      | 'callData_not_execute'
      | 'target_not_registry'
      | 'value_not_zero'
      | 'paymaster_not_ours'
      | 'hash_mismatch'
      | 'factory_not_configured'
      | 'fee_above_ceiling'
      | 'prefund_above_ceiling'
      | 'would_revert'
      | 'chain_unavailable',
    message: string,
    readonly failure?: DecodedFailure,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = 'RelayerRefusal';
  }
}

const EXECUTE_ABI = [
  {
    type: 'function',
    name: 'execute',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

/**
 * `registerCredential(bytes32)`, derived from the shared registry ABI rather
 * than written out as a literal, so a change to the registry cannot leave a
 * stale four-byte constant here quietly misclassifying operations.
 */
const REGISTER_CREDENTIAL_SELECTOR = toFunctionSelector(
  prescriptionRegistryAbi.find(
    (item): item is Extract<(typeof prescriptionRegistryAbi)[number], { name: 'registerCredential' }> =>
      item.type === 'function' && item.name === 'registerCredential',
  )!,
);

/**
 * What the operation actually asks the registry to do.
 *
 * WHY THE RELAYER RE-CHECKS A RULE THE PAYMASTER ALREADY ENFORCES. The same
 * argument `PrescriptionPaymaster._requireRegistryCall` makes about the
 * account: a payer that delegates its own spending rule to the thing it is
 * paying for has no rule. The relayer pays the transaction fee, and it pays it
 * BEFORE the paymaster gets a vote — so "only calls to the registry" has to be
 * this service's rule too, applied to the bytes it was handed.
 */
export function classifyCallData(
  callData: Hex,
  registry: Address,
): { shape: OperationShape; innerCall: Hex } {
  let decoded;

  try {
    decoded = decodeFunctionData({ abi: EXECUTE_ABI, data: callData });
  } catch {
    throw new RelayerRefusal(
      'callData_not_execute',
      'callData is not execute(address,uint256,bytes); this relayer carries nothing else',
    );
  }

  const [target, value, innerCall] = decoded.args;

  if (target.toLowerCase() !== registry.toLowerCase()) {
    throw new RelayerRefusal(
      'target_not_registry',
      `this operation calls ${target}; this relayer only carries calls to the PrescriptionRegistry at ${registry}`,
    );
  }

  if (value !== 0n) {
    throw new RelayerRefusal(
      'value_not_zero',
      `this operation moves ${value} wei; every registry function is non-payable`,
    );
  }

  const selector = innerCall.length >= 10 ? slice(innerCall, 0, 4) : '0x';

  return {
    shape: selector === REGISTER_CREDENTIAL_SELECTOR ? 'register-credential' : 'issue',
    innerCall,
  };
}

/** What the relayer says about itself. NEVER the key. */
export interface RelayerDescription {
  address: Address;
  chainId: number;
  entryPoint: Address;
  registry: Address;
  paymaster: Address;
  factory?: Address;
  /** Test AVAX this relayer can spend on transaction fees before it stops. */
  balanceWei: string;
  /** What the paymaster has left to reimburse with. */
  paymasterDepositWei: string;
  maxFeePerGasWei: string;
  maxPrefundWei: string;
  /** Said out loud, in the payload, so nobody has to infer it. */
  isBundler: false;
}

export interface PrepareInput {
  /** The owner's P-256 public key. The account address is derived from it. */
  publicKeyX: bigint;
  publicKeyY: bigint;
  /** `execute(registry, 0, …)`. Checked, not trusted. */
  callData: Hex;
}

export interface PreparedOperation {
  /** The unsigned operation, exactly as it must be signed and returned. */
  userOp: SerialisedDraft;
  /** What the authenticator's `challenge` has to be. */
  userOpHash: Bytes32;
  /** True when this operation also deploys the account. */
  deploying: boolean;
  shape: OperationShape;
  requiredPrefundWei: string;
}

/** The draft as JSON, because a `bigint` does not survive a response body. */
export interface SerialisedDraft {
  sender: Address;
  nonce: string;
  initCode: Hex;
  callData: Hex;
  verificationGasLimit: string;
  callGasLimit: string;
  preVerificationGas: string;
  maxPriorityFeePerGas: string;
  maxFeePerGas: string;
  paymaster: Address;
  paymasterVerificationGasLimit: string;
  paymasterPostOpGasLimit: string;
  signature: Hex;
}

export function serialiseDraft(draft: UserOperationDraft): SerialisedDraft {
  return {
    sender: draft.sender,
    nonce: draft.nonce.toString(),
    initCode: draft.initCode,
    callData: draft.callData,
    verificationGasLimit: draft.verificationGasLimit.toString(),
    callGasLimit: draft.callGasLimit.toString(),
    preVerificationGas: draft.preVerificationGas.toString(),
    maxPriorityFeePerGas: draft.maxPriorityFeePerGas.toString(),
    maxFeePerGas: draft.maxFeePerGas.toString(),
    paymaster: draft.paymaster?.address ?? ('0x' as Address),
    paymasterVerificationGasLimit: (draft.paymaster?.verificationGasLimit ?? 0n).toString(),
    paymasterPostOpGasLimit: (draft.paymaster?.postOpGasLimit ?? 0n).toString(),
    signature: draft.signature,
  };
}

export function deserialiseDraft(value: SerialisedDraft): UserOperationDraft {
  return {
    sender: value.sender,
    nonce: BigInt(value.nonce),
    initCode: value.initCode,
    callData: value.callData,
    verificationGasLimit: BigInt(value.verificationGasLimit),
    callGasLimit: BigInt(value.callGasLimit),
    preVerificationGas: BigInt(value.preVerificationGas),
    maxPriorityFeePerGas: BigInt(value.maxPriorityFeePerGas),
    maxFeePerGas: BigInt(value.maxFeePerGas),
    paymaster: {
      address: value.paymaster,
      verificationGasLimit: BigInt(value.paymasterVerificationGasLimit),
      postOpGasLimit: BigInt(value.paymasterPostOpGasLimit),
    },
    signature: value.signature,
  };
}

export interface SubmitInput {
  userOp: SerialisedDraft;
  /**
   * What the client believes the hash is.
   *
   * Optional, and NEVER the hash that is used. The relayer recomputes it from
   * the operation and compares; a mismatch means the two sides disagree about
   * the bytes, which is precisely the failure that would otherwise surface as
   * an unexplained `SIG_VALIDATION_FAILED`.
   */
  userOpHash?: Bytes32;
}

export interface Submission {
  userOpHash: Bytes32;
  transactionHash: Hex;
  beneficiary: Address;
}

/**
 * The slack between what the operation reserves and what the transaction is
 * allowed to spend.
 *
 * `requiredGas` covers validation, the call and `preVerificationGas`; the
 * transaction also pays for `handleOps`'s own frame, the deposit bookkeeping
 * and the transfer to the beneficiary. 20% over is generous for that and it is
 * the cap that matters — see defence (3) in the header: this is what stops one
 * reverting submission from burning a block's worth of the relayer's balance.
 */
const TRANSACTION_GAS_SLACK_NUMERATOR = 12n;
const TRANSACTION_GAS_SLACK_DENOMINATOR = 10n;

export class Relayer {
  constructor(
    private readonly chain: RelayerChain,
    private readonly config: RelayerConfig,
  ) {}

  /** Public facts only. The private key is not reachable from here. */
  async describe(): Promise<RelayerDescription> {
    const [balanceWei, paymasterDepositWei] = await Promise.all([
      this.chain.getBalance(),
      this.chain.getPaymasterDeposit(this.config.paymaster),
    ]);

    return {
      address: this.chain.address,
      chainId: this.config.chainId,
      entryPoint: this.config.entryPoint,
      registry: this.config.registry,
      paymaster: this.config.paymaster,
      ...(this.config.factory === undefined ? {} : { factory: this.config.factory }),
      balanceWei: balanceWei.toString(),
      paymasterDepositWei: paymasterDepositWei.toString(),
      maxFeePerGasWei: this.config.maxFeePerGasWei.toString(),
      maxPrefundWei: this.config.maxPrefundWei.toString(),
      isBundler: false,
    };
  }

  /**
   * Build the operation the doctor is about to sign, and say what its hash is.
   *
   * WHY THIS STEP EXISTS AT ALL, rather than letting the client assemble the
   * operation itself. Because the signature commits to the hash, the hash
   * commits to every gas field, and therefore NOTHING MAY CHANGE AFTER SIGNING
   * — a relayer that "helpfully" adjusted a gas limit on submission would
   * invalidate the assertion it was handed. The nonce, the fees and the gas
   * sizing all have to be settled before the authenticator is asked for
   * anything, which means they have to be settled here.
   *
   * THE ACCOUNT ADDRESS IS DERIVED FROM THE PUBLIC KEY, never taken from the
   * caller. `PasskeyAccountFactory.getAddress` is a CREATE2 commitment to the
   * key, so this relayer can only ever prepare an operation for the account
   * that key controls. A caller cannot name somebody else's account.
   */
  async prepare(input: PrepareInput): Promise<PreparedOperation> {
    if (this.config.factory === undefined) {
      throw new RelayerRefusal(
        'factory_not_configured',
        'this relayer has no PasskeyAccountFactory configured, so it cannot derive an account address',
      );
    }

    const { shape } = classifyCallData(input.callData, this.config.registry);

    const sender = await this.chain.predictAccount(
      this.config.factory,
      input.publicKeyX,
      input.publicKeyY,
    );

    const [codeSize, nonce, fees] = await Promise.all([
      this.chain.getCodeSize(sender),
      this.chain.getNonce(sender),
      this.chain.getFees(),
    ]);

    /**
     * The counterfactual case. No code at the address means the account does
     * not exist, so this operation has to deploy it — and the EntryPoint does
     * that from `initCode`, inside the operation, paid for by the paymaster.
     * The doctor signs an assertion, never a deployment transaction.
     */
    const deploying = codeSize === 0;

    const initCode: Hex = deploying
      ? encodeInitCode(this.config.factory, input.publicKeyX, input.publicKeyY)
      : '0x';

    const { maxFeePerGas, maxPriorityFeePerGas } = sizeFees({
      baseFeePerGas: fees.baseFeePerGas,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      ceilingWei: this.config.maxFeePerGasWei,
    });

    const accountGas = sizeAccountGas({ deploying, shape });

    const withoutPreVerification: UserOperationDraft = {
      sender,
      nonce,
      initCode,
      callData: input.callData,
      verificationGasLimit: accountGas.verificationGasLimit,
      callGasLimit: accountGas.callGasLimit,
      preVerificationGas: 0n,
      maxPriorityFeePerGas,
      maxFeePerGas,
      paymaster: {
        address: this.config.paymaster,
        verificationGasLimit: PAYMASTER_VERIFICATION_GAS_LIMIT,
        postOpGasLimit: PAYMASTER_POST_OP_GAS_LIMIT,
      },
      signature: '0x',
    };

    const draft: UserOperationDraft = {
      ...withoutPreVerification,
      preVerificationGas: sizePreVerificationGas({
        draft: withoutPreVerification,
        beneficiary: this.chain.address,
      }),
    };

    this.assertPolicy(draft);

    return {
      userOp: serialiseDraft(draft),
      userOpHash: this.hash(draft),
      deploying,
      shape,
      requiredPrefundWei: (requiredGas(draft) * draft.maxFeePerGas).toString(),
    };
  }

  /**
   * Check the signed operation and send it.
   *
   * The order is deliberate: every check that costs nothing runs before the one
   * that costs an RPC round trip, and the round trip runs before anything is
   * signed by the relayer's key.
   */
  async submit(input: SubmitInput): Promise<Submission> {
    const draft = deserialiseDraft(input.userOp);

    classifyCallData(draft.callData, this.config.registry);

    if (draft.paymaster?.address.toLowerCase() !== this.config.paymaster.toLowerCase()) {
      throw new RelayerRefusal(
        'paymaster_not_ours',
        `this operation names paymaster ${draft.paymaster?.address}; this relayer only carries operations sponsored by ${this.config.paymaster}`,
      );
    }

    this.assertPolicy(draft);

    const userOpHash = this.hash(draft);

    if (input.userOpHash !== undefined && input.userOpHash.toLowerCase() !== userOpHash.toLowerCase()) {
      throw new RelayerRefusal(
        'hash_mismatch',
        `the client signed ${input.userOpHash} but this operation hashes to ${userOpHash}; the two sides disagree about the bytes`,
      );
    }

    const userOp = packUserOperation(draft);

    // Defence (1): simulate before signing anything. A refusal here costs an
    // eth_call and returns the paymaster's own error with its arguments.
    try {
      await this.chain.simulateHandleOps(userOp);
    } catch (error) {
      const revertData = revertDataOf(error);

      // A VERDICT AND AN UNANSWERED CALL ASK FOR OPPOSITE THINGS, and the
      // revert bytes cannot tell them apart on their own: `revert()` with no
      // reason is a verdict carrying nothing. So the node's own "execution
      // reverted" is what decides, and the bytes only supply the words. A
      // timeout, an HTTP 429 or a Cloudflare 1015 page (this project has had
      // that one) carries neither, and `would_revert` would send a doctor
      // hunting a fault in a prescription that is fine.
      if (!isExecutionRevert(error) && revertData === undefined) {
        throw new RelayerRefusal(
          'chain_unavailable',
          'the chain could not be reached to check this operation; nothing was signed or sent, so it can be retried unchanged',
          undefined,
          error,
        );
      }

      const failure = decodeHandleOpsFailure(revertData);

      throw new RelayerRefusal(
        'would_revert',
        failure.name === undefined
          ? `this operation would revert${failure.entryPointReason === undefined ? '' : `: ${failure.entryPointReason}`}`
          : `this operation would revert with ${failure.name}`,
        failure,
      );
    }

    // Defence (3): an explicit cap, so a revert that slips past simulation
    // cannot burn an unbounded amount of the relayer's own AVAX.
    const gas =
      (requiredGas(draft) * TRANSACTION_GAS_SLACK_NUMERATOR) / TRANSACTION_GAS_SLACK_DENOMINATOR;

    const transactionHash = await this.chain.sendHandleOps(userOp, gas);

    return { userOpHash, transactionHash, beneficiary: this.chain.address };
  }

  private hash(draft: UserOperationDraft): Bytes32 {
    return getUserOpHash({
      userOp: packUserOperation(draft),
      entryPoint: this.config.entryPoint,
      chainId: this.config.chainId,
    });
  }

  private assertPolicy(draft: UserOperationDraft): void {
    try {
      assertWithinPolicy(draft, {
        maxFeePerGasWei: this.config.maxFeePerGasWei,
        maxPrefundWei: this.config.maxPrefundWei,
      });
    } catch (error) {
      if (error instanceof GasPolicyError) {
        throw new RelayerRefusal(error.code, error.message);
      }

      throw error;
    }
  }
}

/**
 * Whether the node returned a verdict on this operation, or never answered.
 *
 * JSON-RPC error code 3 — "execution reverted" — is the one thing present in
 * EVERY revert, including a bare `revert()` that carries no data to decode, and
 * viem keeps it: on the `RpcRequestError` it builds from the response, on the
 * raw error member underneath it, and as the static `code` of its own
 * `ExecutionRevertedError`. A transport failure reaches `UnknownRpcError` with
 * code -1 instead and produces none of the three.
 *
 * Matched structurally rather than with `instanceof` because the code sits on a
 * plain object at the bottom of the chain, and because `@recetas/api` must not
 * depend on which of viem's wrappers happens to be on top this release.
 */
export function isExecutionRevert(error: unknown): boolean {
  let candidate: unknown = error;

  for (let depth = 0; depth < 10 && candidate !== null && typeof candidate === 'object'; depth += 1) {
    const record = candidate as { code?: unknown; name?: unknown; cause?: unknown };

    if (record.code === ExecutionRevertedError.code || record.name === 'ExecutionRevertedError') {
      return true;
    }

    candidate = record.cause;
  }

  return false;
}

/**
 * The revert bytes out of whatever the chain adapter threw.
 *
 * Walks the `cause` chain for the same reason
 * `@recetas/chain`'s `decodeRegistryRevertData` does: a transport wraps the
 * blob, and the depth varies by provider.
 *
 * ONLY EVER THE WORDS, NEVER THE VERDICT — `isExecutionRevert` decides that.
 * This returns `undefined` for a reasonless revert as readily as for a timeout,
 * and reading a classification out of it is what inverted one.
 */
export function revertDataOf(error: unknown): Hex | undefined {
  let candidate: unknown = error;

  for (let depth = 0; depth < 10 && candidate !== null && typeof candidate === 'object'; depth += 1) {
    const record = candidate as { data?: unknown; cause?: unknown };

    if (typeof record.data === 'string' && record.data.startsWith('0x')) {
      return record.data as Hex;
    }

    candidate = record.cause;
  }

  return undefined;
}
