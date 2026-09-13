import { describe, expect, it, vi } from 'vitest';
import { RpcRequestError, createPublicClient, custom, encodeErrorResult, encodeFunctionData } from 'viem';
import {
  ENTRY_POINT_V07_ADDRESS,
  entryPointV07Abi,
  getUserOpHash,
  packUserOperation,
  prescriptionRegistryAbi,
  type PackedUserOperation,
} from '@recetas/chain';
import type { Address, Bytes32, Hex } from '@recetas/shared';
import type { RelayerConfig } from '../env';
import {
  DEPLOYMENT_VERIFICATION_GAS_LIMIT,
  ISSUE_CALL_GAS_LIMIT,
  REGISTER_CALL_GAS_LIMIT,
  VERIFICATION_GAS_LIMIT,
} from './gas-policy';
import { prescriptionPaymasterErrorsAbi } from './failures';
import {
  Relayer,
  RelayerRefusal,
  classifyCallData,
  deserialiseDraft,
  isExecutionRevert,
  revertDataOf,
  serialiseDraft,
  type RelayerChain,
} from './relayer';

/**
 * The relayer, with no chain anywhere near it.
 *
 * Everything that decides something is pure — the packing, the hash, the policy,
 * the refusals — and `RelayerChain` is the seam. That is what lets these tests
 * assert what happens when a client signs bytes that hash to something else, or
 * names a paymaster the relayer does not carry, without a node.
 */

const REGISTRY = '0xD5F2d5aD03703a9Ee11078d86181421E2E078365' as Address;
const PAYMASTER = `0x${'88'.repeat(20)}` as Address;
const FACTORY = `0x${'99'.repeat(20)}` as Address;
const RELAYER_ADDRESS = '0x4429d872fB9253C8516AE525b03cE06FbbbEC143' as Address;
const ACCOUNT = '0x7b33436643a681262562785C02Cba36524491042' as Address;
const OTHER = '0x000000000000000000000000000000000000dEaD' as Address;
const CREDENTIAL_UID = `0x${'11'.repeat(32)}` as Bytes32;
const PUBLIC_KEY_X = 28_573_233_055_232_466_711_029_625_910_063_034_642_429_572_463_461_595_413_086_259_353_299_906_450_061n;
const PUBLIC_KEY_Y = 39_367_742_072_897_599_771_788_408_398_752_356_480_431_855_827_262_528_811_857_788_332_151_452_825_281n;

/**
 * THE KEY IS A REAL-LOOKING VALUE ON PURPOSE. Several tests below assert that
 * it never appears in anything the relayer says, and an obviously fake string
 * would make those assertions weaker than they look. It is a throwaway constant
 * in a test file; it holds nothing, on any chain.
 */
const THROWAWAY_KEY = `0x${'7c'.repeat(32)}` as const;

const config: RelayerConfig = {
  privateKey: THROWAWAY_KEY,
  rpcUrl: 'http://localhost:8545',
  chainId: 43113,
  entryPoint: ENTRY_POINT_V07_ADDRESS,
  registry: REGISTRY,
  paymaster: PAYMASTER,
  factory: FACTORY,
  maxFeePerGasWei: 100_000_000_000n,
  maxPrefundWei: 20_000_000_000_000_000n,
  rateLimit: 30,
  rateLimitWindowSeconds: 60,
};

const executeAbi = [
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

function executeCall(target: Address, value: bigint, inner: Hex): Hex {
  return encodeFunctionData({ abi: executeAbi, functionName: 'execute', args: [target, value, inner] });
}

const REGISTER_INNER = encodeFunctionData({
  abi: prescriptionRegistryAbi,
  functionName: 'registerCredential',
  args: [CREDENTIAL_UID],
});

const ISSUE_INNER = encodeFunctionData({
  abi: prescriptionRegistryAbi,
  functionName: 'issue',
  args: [`0x${'22'.repeat(32)}` as Bytes32, `0x${'33'.repeat(32)}` as Bytes32, 1_800_000_000n],
});

const REGISTER_CALL_DATA = executeCall(REGISTRY, 0n, REGISTER_INNER);
const ISSUE_CALL_DATA = executeCall(REGISTRY, 0n, ISSUE_INNER);

/**
 * The error viem actually throws, built by viem.
 *
 * WHY THESE TESTS DO NOT FABRICATE ONE. They used to, as
 * `Object.assign(new Error(…), { cause: { data } })` — a shape no transport
 * emits — and that is precisely how the revert/unreachable classification came
 * to be inverted with every test still green. So this drives a real
 * `publicClient.call`, the same action `viem-relayer-chain.ts` uses, against a
 * transport that answers the way a node does, and hands back whatever viem
 * wrapped it in. If viem changes how it wraps, these tests notice.
 */
function stubbedClient(answer: () => never) {
  return createPublicClient({
    // No retries: viem retries a transport failure by default, and these tests
    // want the error it ends up with, not the wall-clock cost of getting there.
    transport: custom(
      { request: async ({ method }) => (method === 'eth_chainId' ? '0x1' : answer()) },
      { retryCount: 0 },
    ),
  });
}

async function viemCallError(answer: () => never): Promise<unknown> {
  const client = stubbedClient(answer);

  try {
    await client.call({ to: ENTRY_POINT_V07_ADDRESS, data: '0x' });

    return expect.unreachable('the stub transport must fail');
  } catch (error) {
    return error;
  }
}

/** Exactly what a node returns for a revert: JSON-RPC code 3, plus the payload. */
function revertResponse(data?: Hex): () => never {
  return () => {
    throw new RpcRequestError({
      body: {},
      url: 'http://node.invalid',
      error: { code: 3, message: 'execution reverted', ...(data === undefined ? {} : { data }) },
    });
  };
}

/** A node refusing the call, as `viem-relayer-chain.ts` would see it. */
function nodeReverted(data?: Hex): Promise<unknown> {
  return viemCallError(revertResponse(data));
}

/** A node that never answered. Not a verdict on anything. */
function nodeUnreachable(failure: Error): Promise<unknown> {
  return viemCallError(() => {
    throw failure;
  });
}

interface FakeChainOptions {
  codeSize?: number;
  nonce?: bigint;
  baseFeePerGas?: bigint;
  maxPriorityFeePerGas?: bigint;
  simulate?: () => Promise<void>;
}

function fakeChain(options: FakeChainOptions = {}) {
  const sent: Array<{ userOp: PackedUserOperation; gas: bigint }> = [];

  const chain: RelayerChain = {
    address: RELAYER_ADDRESS,
    getBalance: async () => 3_499_000_000_000_000_000n,
    getCodeSize: async () => options.codeSize ?? 0,
    getNonce: async () => options.nonce ?? 0n,
    getFees: async () => ({
      baseFeePerGas: options.baseFeePerGas ?? 10n,
      maxPriorityFeePerGas: options.maxPriorityFeePerGas ?? 150n,
    }),
    predictAccount: async () => ACCOUNT,
    getPaymasterDeposit: async () => 1_000_000_000_000_000_000n,
    simulateHandleOps: options.simulate ?? (async () => {}),
    sendHandleOps: async (userOp, gas) => {
      sent.push({ userOp, gas });

      return `0x${'ab'.repeat(32)}` as Hex;
    },
  };

  return { chain, sent };
}

describe('what this relayer will carry', () => {
  it('accepts execute(registry, 0, registerCredential(uid)) and names the shape', () => {
    expect(classifyCallData(REGISTER_CALL_DATA, REGISTRY).shape).toBe('register-credential');
  });

  it('accepts execute(registry, 0, issue(...)) and names the shape', () => {
    expect(classifyCallData(ISSUE_CALL_DATA, REGISTRY).shape).toBe('issue');
  });

  it('refuses calldata that is not execute at all', () => {
    expect(() => classifyCallData('0xdeadbeef', REGISTRY)).toThrow(RelayerRefusal);
  });

  /**
   * The paymaster enforces this too. It is re-checked here for the reason
   * `PrescriptionPaymaster._requireRegistryCall` gives about the account: a
   * payer that delegates its own spending rule to the thing it is paying for
   * has no rule — and this relayer pays the transaction fee BEFORE the
   * paymaster gets a vote.
   */
  it('refuses a call to anything other than the registry', () => {
    try {
      classifyCallData(executeCall(OTHER, 0n, REGISTER_INNER), REGISTRY);
      expect.unreachable('should have refused');
    } catch (error) {
      expect((error as RelayerRefusal).code).toBe('target_not_registry');
    }
  });

  it('refuses an operation that moves value', () => {
    try {
      classifyCallData(executeCall(REGISTRY, 1n, REGISTER_INNER), REGISTRY);
      expect.unreachable('should have refused');
    } catch (error) {
      expect((error as RelayerRefusal).code).toBe('value_not_zero');
    }
  });
});

describe('preparing the first operation of an account’s life', () => {
  it('carries initCode when no code exists at the address', async () => {
    const { chain } = fakeChain({ codeSize: 0 });
    const prepared = await new Relayer(chain, config).prepare({
      publicKeyX: PUBLIC_KEY_X,
      publicKeyY: PUBLIC_KEY_Y,
      callData: REGISTER_CALL_DATA,
    });

    expect(prepared.deploying).toBe(true);
    expect(prepared.userOp.initCode.slice(0, 42).toLowerCase()).toBe(FACTORY.toLowerCase());
    expect(prepared.userOp.verificationGasLimit).toBe(DEPLOYMENT_VERIFICATION_GAS_LIMIT.toString());
    expect(prepared.userOp.callGasLimit).toBe(REGISTER_CALL_GAS_LIMIT.toString());
  });

  it('carries no initCode once the account exists', async () => {
    const { chain } = fakeChain({ codeSize: 1_234 });
    const prepared = await new Relayer(chain, config).prepare({
      publicKeyX: PUBLIC_KEY_X,
      publicKeyY: PUBLIC_KEY_Y,
      callData: ISSUE_CALL_DATA,
    });

    expect(prepared.deploying).toBe(false);
    expect(prepared.userOp.initCode).toBe('0x');
    expect(prepared.userOp.verificationGasLimit).toBe(VERIFICATION_GAS_LIMIT.toString());
    expect(prepared.userOp.callGasLimit).toBe(ISSUE_CALL_GAS_LIMIT.toString());
  });

  /**
   * `PrescriptionPaymaster` sponsors an unregistered account for exactly one
   * thing: `registerCredential(uid)` whose uid is already a live credential
   * issued to it. An `issue` as the first operation is `NotAccredited` before
   * it reaches the registry.
   */
  it('the first operation an account can actually get sponsored is a registration', async () => {
    const { chain } = fakeChain({ codeSize: 0 });
    const prepared = await new Relayer(chain, config).prepare({
      publicKeyX: PUBLIC_KEY_X,
      publicKeyY: PUBLIC_KEY_Y,
      callData: REGISTER_CALL_DATA,
    });

    expect(prepared).toMatchObject({ deploying: true, shape: 'register-credential' });
  });

  /**
   * The address is a CREATE2 commitment to the public key, so a caller cannot
   * name somebody else's account: they can only ask about the one their key
   * controls.
   */
  it('derives the sender from the public key and never takes it from the caller', async () => {
    const { chain } = fakeChain();
    const predict = vi.spyOn(chain, 'predictAccount');

    const prepared = await new Relayer(chain, config).prepare({
      publicKeyX: PUBLIC_KEY_X,
      publicKeyY: PUBLIC_KEY_Y,
      callData: REGISTER_CALL_DATA,
    });

    expect(predict).toHaveBeenCalledWith(FACTORY, PUBLIC_KEY_X, PUBLIC_KEY_Y);
    expect(prepared.userOp.sender).toBe(ACCOUNT);
  });

  it('names this relayer’s paymaster in paymasterAndData', async () => {
    const { chain } = fakeChain();
    const prepared = await new Relayer(chain, config).prepare({
      publicKeyX: PUBLIC_KEY_X,
      publicKeyY: PUBLIC_KEY_Y,
      callData: REGISTER_CALL_DATA,
    });

    expect(prepared.userOp.paymaster).toBe(PAYMASTER);
  });

  it('reads the nonce from the EntryPoint rather than assuming zero', async () => {
    const { chain } = fakeChain({ nonce: 9n });
    const prepared = await new Relayer(chain, config).prepare({
      publicKeyX: PUBLIC_KEY_X,
      publicKeyY: PUBLIC_KEY_Y,
      callData: REGISTER_CALL_DATA,
    });

    expect(prepared.userOp.nonce).toBe('9');
  });

  /**
   * THE HASH IS THE WHOLE HANDOFF. It is what travels into `clientDataJSON` as
   * the base64url `challenge`, and it is what `PasskeyAccount.validateUserOp`
   * checks the assertion against. If the hash the relayer reports is not the
   * hash of the operation it returned, the doctor signs one thing and the chain
   * checks another.
   */
  it('reports the hash of exactly the operation it returned', async () => {
    const { chain } = fakeChain();
    const prepared = await new Relayer(chain, config).prepare({
      publicKeyX: PUBLIC_KEY_X,
      publicKeyY: PUBLIC_KEY_Y,
      callData: REGISTER_CALL_DATA,
    });

    expect(prepared.userOpHash).toBe(
      getUserOpHash({
        userOp: packUserOperation(deserialiseDraft(prepared.userOp)),
        entryPoint: ENTRY_POINT_V07_ADDRESS,
        chainId: 43113,
      }),
    );
  });

  it('refuses to prepare anything when no factory is configured', async () => {
    const { chain } = fakeChain();
    const { factory: _factory, ...withoutFactory } = config;

    await expect(
      new Relayer(chain, withoutFactory).prepare({
        publicKeyX: PUBLIC_KEY_X,
        publicKeyY: PUBLIC_KEY_Y,
        callData: REGISTER_CALL_DATA,
      }),
    ).rejects.toThrow(/no PasskeyAccountFactory configured/);
  });
});

describe('submitting a signed operation', () => {
  async function prepared(options: FakeChainOptions = {}) {
    const { chain, sent } = fakeChain(options);
    const relayer = new Relayer(chain, config);
    const result = await relayer.prepare({
      publicKeyX: PUBLIC_KEY_X,
      publicKeyY: PUBLIC_KEY_Y,
      callData: REGISTER_CALL_DATA,
    });

    return { chain, sent, relayer, result };
  }

  it('sends the operation and reports both hashes', async () => {
    const { relayer, result, sent } = await prepared();

    const submission = await relayer.submit({
      userOp: { ...result.userOp, signature: `0x${'cd'.repeat(256)}` },
    });

    expect(sent).toHaveLength(1);
    expect(submission.transactionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(submission.beneficiary).toBe(RELAYER_ADDRESS);
  });

  /**
   * The beneficiary is what the EntryPoint reimburses out of the paymaster's
   * deposit when the operation succeeds. It has to be the relayer, or the
   * relayer pays the transaction fee and somebody else collects the refund.
   */
  it('names itself as beneficiary, which is what gets reimbursed', async () => {
    const { relayer, result } = await prepared();

    const submission = await relayer.submit({ userOp: result.userOp });

    expect(submission.beneficiary).toBe(RELAYER_ADDRESS);
  });

  /** Defence (3): an explicit cap, so one revert cannot burn a block of gas. */
  it('caps the transaction gas at the operation’s own budget plus slack', async () => {
    const { relayer, result, sent } = await prepared();

    await relayer.submit({ userOp: result.userOp });

    const draft = deserialiseDraft(result.userOp);
    const budget =
      draft.verificationGasLimit +
      draft.callGasLimit +
      draft.preVerificationGas +
      (draft.paymaster?.verificationGasLimit ?? 0n);

    expect(sent[0]!.gas).toBeGreaterThan(budget);
    expect(sent[0]!.gas).toBeLessThan(budget * 2n);
  });

  /**
   * The signature is not in the hash, so signing does not change it. This is
   * what makes the two-step flow possible at all.
   */
  it('reports the same hash it prepared, once the assertion is attached', async () => {
    const { relayer, result } = await prepared();

    const submission = await relayer.submit({
      userOp: { ...result.userOp, signature: `0x${'cd'.repeat(256)}` },
    });

    expect(submission.userOpHash).toBe(result.userOpHash);
  });

  /**
   * THE CLIENT'S HASH IS NEVER THE ONE THAT IS USED. It is compared. A mismatch
   * means the two sides disagree about the bytes, which is exactly the failure
   * that would otherwise arrive as an unexplained `SIG_VALIDATION_FAILED`.
   */
  it('refuses an operation whose hash the client got wrong', async () => {
    const { relayer, result } = await prepared();

    try {
      await relayer.submit({ userOp: result.userOp, userOpHash: `0x${'00'.repeat(32)}` });
      expect.unreachable('should have refused');
    } catch (error) {
      expect((error as RelayerRefusal).code).toBe('hash_mismatch');
    }
  });

  it('refuses an operation whose fields were changed after signing', async () => {
    const { relayer, result } = await prepared();

    try {
      await relayer.submit({
        userOp: { ...result.userOp, callGasLimit: '999999' },
        userOpHash: result.userOpHash,
      });
      expect.unreachable('should have refused');
    } catch (error) {
      expect((error as RelayerRefusal).code).toBe('hash_mismatch');
    }
  });

  /** Defence (4): all of the cost, none of the purpose. */
  it('refuses an operation sponsored by somebody else’s paymaster', async () => {
    const { relayer, result } = await prepared();

    try {
      await relayer.submit({ userOp: { ...result.userOp, paymaster: OTHER } });
      expect.unreachable('should have refused');
    } catch (error) {
      expect((error as RelayerRefusal).code).toBe('paymaster_not_ours');
    }
  });

  it('refuses an operation pointed at anything but the registry', async () => {
    const { relayer, result } = await prepared();

    try {
      await relayer.submit({
        userOp: { ...result.userOp, callData: executeCall(OTHER, 0n, REGISTER_INNER) },
      });
      expect.unreachable('should have refused');
    } catch (error) {
      expect((error as RelayerRefusal).code).toBe('target_not_registry');
    }
  });

  it('refuses a fee above its own ceiling', async () => {
    const { relayer, result } = await prepared();

    try {
      await relayer.submit({ userOp: { ...result.userOp, maxFeePerGas: '999999999999999' } });
      expect.unreachable('should have refused');
    } catch (error) {
      expect((error as RelayerRefusal).code).toBe('fee_above_ceiling');
    }
  });

  /**
   * DEFENCE (1), AND THE REASON IT IS WORTH THE ROUND TRIP. Nothing is signed
   * until the operation has been `eth_call`-ed, so an operation that would
   * revert costs the relayer an RPC call rather than a burned transaction — and
   * the client receives the paymaster's own error with its four arguments
   * instead of an opaque failure.
   */
  it('simulates before signing, and never sends what would revert', async () => {
    const inner = encodeErrorResult({
      abi: prescriptionPaymasterErrorsAbi,
      errorName: 'SponsorshipExhausted',
      args: [ACCOUNT, 40, 40, 1_757_600_000n],
    });

    const revert = encodeErrorResult({
      abi: entryPointV07Abi,
      errorName: 'FailedOpWithRevert',
      args: [0n, 'AA33 reverted', inner],
    });

    const thrown = await nodeReverted(revert);
    const { relayer, result, sent } = await prepared({
      simulate: async () => {
        throw thrown;
      },
    });

    try {
      await relayer.submit({ userOp: result.userOp });
      expect.unreachable('should have refused');
    } catch (error) {
      const refusal = error as RelayerRefusal;

      expect(refusal.code).toBe('would_revert');
      expect(refusal.failure?.name).toBe('SponsorshipExhausted');
      expect(refusal.failure?.args?.windowEndsAt).toBe(1_757_600_000n);
    }

    expect(sent).toHaveLength(0);
  });

  /**
   * THE CASE THAT PAYS FOR THE CALL SHAPE. The EntryPoint ABI the simulation is
   * encoded with has never heard of `SponsorshipExhausted`, and viem's
   * `simulateContract` would have reduced this to a four-byte signature with no
   * arguments — which is what made `failures.ts` unreachable through this path.
   * Reading the raw bytes instead, the paymaster's own vocabulary decodes.
   */
  it('names a paymaster error the EntryPoint ABI does not contain', async () => {
    const bare = encodeErrorResult({
      abi: prescriptionPaymasterErrorsAbi,
      errorName: 'CostNotSponsored',
      args: [5_000_000_000_000_000n, 1_000_000_000_000_000n],
    });

    const thrown = await nodeReverted(bare);
    const { relayer, result, sent } = await prepared({
      simulate: async () => {
        throw thrown;
      },
    });

    try {
      await relayer.submit({ userOp: result.userOp });
      expect.unreachable('should have refused');
    } catch (error) {
      const refusal = error as RelayerRefusal;

      expect(refusal.code).toBe('would_revert');
      expect(refusal.failure?.source).toBe('paymaster');
      expect(refusal.failure?.name).toBe('CostNotSponsored');
      expect(refusal.failure?.args?.allowed).toBe(1_000_000_000_000_000n);
      expect(refusal.message).toContain('CostNotSponsored');
    }

    expect(sent).toHaveLength(0);
  });

  /**
   * WHY THE CHAIN ADAPTER SIMULATES WITH `call` AND NOT `simulateContract`,
   * pinned as a failing test rather than left as an argument in a comment.
   *
   * viem 2.21.54's `getContractError` rebuilds the error around a FRESH
   * `ContractFunctionRevertedError` and discards the one that held the hex;
   * what survives is decoded against the ABI the call was given, and the
   * EntryPoint ABI contains none of the paymaster's errors. Both things this
   * refusal needs are lost: the bytes `failures.ts` reads, AND the node's
   * "execution reverted" — so every genuine revert would come back as an
   * unreachable chain. That is the bug this test exists to keep fixed. If a
   * viem upgrade changes either, it fails and the adapter can be revisited.
   */
  it('would lose both the bytes and the verdict if it simulated through simulateContract', async () => {
    const bare = encodeErrorResult({
      abi: prescriptionPaymasterErrorsAbi,
      errorName: 'NotAccredited',
      args: [ACCOUNT],
    });

    const { result } = await prepared();

    try {
      await stubbedClient(revertResponse(bare)).simulateContract({
        address: ENTRY_POINT_V07_ADDRESS,
        abi: entryPointV07Abi,
        functionName: 'handleOps',
        args: [[packUserOperation(deserialiseDraft(result.userOp))], RELAYER_ADDRESS],
        account: RELAYER_ADDRESS,
      });
      expect.unreachable('the stub transport must revert');
    } catch (error) {
      expect(revertDataOf(error)).toBeUndefined();
      expect(isExecutionRevert(error)).toBe(false);
    }

    // The shape the adapter does use keeps both.
    const viaCall = await nodeReverted(bare);

    expect(revertDataOf(viaCall)).toBe(bare);
    expect(isExecutionRevert(viaCall)).toBe(true);
  });

  /**
   * THE CLASSIFICATION IS NOT DRAWN ON THE BYTES. A bare `revert()` is a
   * verdict that carries nothing to decode, and a relayer reading "no bytes" as
   * "no answer" would tell a doctor to retry an operation the chain has already
   * refused, forever. The node said `execution reverted`; that is the verdict,
   * whether or not it said why.
   */
  it('calls a reasonless revert a revert, not an unreachable chain', async () => {
    const thrown = await nodeReverted();
    const { relayer, result, sent } = await prepared({
      simulate: async () => {
        throw thrown;
      },
    });

    try {
      await relayer.submit({ userOp: result.userOp });
      expect.unreachable('should have refused');
    } catch (error) {
      expect((error as RelayerRefusal).code).toBe('would_revert');
    }

    expect(sent).toHaveLength(0);
  });

  /**
   * A SILENT NODE IS NOT A REVERT. A timeout, a 429 or a Cloudflare page carries
   * neither a verdict nor revert data, and this project has had the Cloudflare
   * one. Told `would_revert`, a doctor hunts a fault in a prescription that is
   * fine. This test and the one above fail in opposite directions, which is the
   * point: neither passes if the two are swapped.
   */
  it('says the chain was unreachable when the node never answered', async () => {
    const transport = Object.assign(new Error('<!DOCTYPE html> error code: 1015'), {
      name: 'HttpRequestError',
      status: 429,
    });

    const thrown = await nodeUnreachable(transport);
    const { relayer, result, sent } = await prepared({
      simulate: async () => {
        throw thrown;
      },
    });

    try {
      await relayer.submit({ userOp: result.userOp });
      expect.unreachable('should have refused');
    } catch (error) {
      const refusal = error as RelayerRefusal;

      expect(refusal.code).toBe('chain_unavailable');
      // What the route logs at warn. Without it an operator reads "refused" and
      // goes looking for a validation bug instead of for the node.
      expect(refusal.cause).toBe(thrown);
      expect(refusal.failure).toBeUndefined();
    }

    expect(sent).toHaveLength(0);
  });
});

describe('what the relayer says about itself', () => {
  it('reports the chain, the contracts and what it has left', async () => {
    const { chain } = fakeChain();

    await expect(new Relayer(chain, config).describe()).resolves.toMatchObject({
      address: RELAYER_ADDRESS,
      chainId: 43113,
      entryPoint: ENTRY_POINT_V07_ADDRESS,
      registry: REGISTRY,
      paymaster: PAYMASTER,
      isBundler: false,
    });
  });

  /**
   * NOT A BUNDLER, SAID IN THE PAYLOAD. No mempool, no bundling, no ERC-7562,
   * no reputation, no stake. A field is cheaper than a paragraph nobody reads.
   */
  it('says out loud that it is not a bundler', async () => {
    const { chain } = fakeChain();

    expect((await new Relayer(chain, config).describe()).isBundler).toBe(false);
  });

  /** THE KEY NEVER TRAVELS. Not in this payload, not in any other. */
  it('never mentions the private key', async () => {
    const { chain } = fakeChain();
    const described = JSON.stringify(await new Relayer(chain, config).describe());

    expect(described).not.toContain(THROWAWAY_KEY);
    expect(described).not.toContain(THROWAWAY_KEY.slice(2));
  });
});

describe('the wire shape', () => {
  it('round trips a draft through JSON without losing a bigint', () => {
    const { chain: _chain } = fakeChain();
    const draft = deserialiseDraft({
      sender: ACCOUNT,
      nonce: '9',
      initCode: '0x',
      callData: REGISTER_CALL_DATA,
      verificationGasLimit: '450000',
      callGasLimit: '150000',
      preVerificationGas: '60000',
      maxPriorityFeePerGas: '150',
      maxFeePerGas: '1000',
      paymaster: PAYMASTER,
      paymasterVerificationGasLimit: '200000',
      paymasterPostOpGasLimit: '0',
      signature: '0x',
    });

    expect(deserialiseDraft(serialiseDraft(draft))).toEqual(draft);
  });
});

describe('finding the revert bytes wherever the transport put them', () => {
  it('reads them from the top level', () => {
    expect(revertDataOf({ data: '0xdeadbeef' })).toBe('0xdeadbeef');
  });

  it('walks the cause chain', () => {
    expect(revertDataOf({ cause: { cause: { data: '0xdeadbeef' } } })).toBe('0xdeadbeef');
  });

  /**
   * The depth is viem's, not ours: `CallExecutionError` → `ExecutionRevertedError`
   * → `RpcRequestError` → the raw JSON-RPC error member that holds the bytes.
   */
  it('finds them in the error viem actually builds', async () => {
    expect(revertDataOf(await nodeReverted('0xdeadbeef'))).toBe('0xdeadbeef');
  });

  it('gives up rather than inventing something', async () => {
    expect(revertDataOf(new Error('nothing here'))).toBeUndefined();
    expect(revertDataOf(undefined)).toBeUndefined();
    expect(revertDataOf(await nodeReverted())).toBeUndefined();
    expect(revertDataOf(await nodeUnreachable(new Error('timed out')))).toBeUndefined();
  });
});

/**
 * THE DISTINCTION THE WHOLE REFUSAL HANGS ON, tested on its own because the two
 * cases it separates are the two an operator acts on differently: fix the
 * operation, or wait for the node.
 */
describe('telling a verdict from an unanswered call', () => {
  it('recognises a revert with data', async () => {
    expect(isExecutionRevert(await nodeReverted('0xdeadbeef'))).toBe(true);
  });

  it('recognises a revert without data, which has no bytes to go on', async () => {
    expect(isExecutionRevert(await nodeReverted())).toBe(true);
  });

  it('does not mistake a transport failure for one', async () => {
    expect(isExecutionRevert(await nodeUnreachable(new Error('The request took too long.')))).toBe(
      false,
    );
    expect(isExecutionRevert(new Error('nothing here'))).toBe(false);
    expect(isExecutionRevert(undefined)).toBe(false);
  });
});
