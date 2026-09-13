import { describe, expect, it } from 'vitest';
import { encodeFunctionData, size } from 'viem';
import type { Address, Hex } from '@recetas/shared';
import { ENTRY_POINT_V07_ADDRESS } from './entry-point-abi';
import { prescriptionRegistryAbi } from './registry-abi';
import {
  PAYMASTER_DATA_OFFSET,
  PLACEHOLDER_ASSERTION_SIGNATURE,
  UserOperationEncodingError,
  decodePaymasterAndData,
  encodeHandleOps,
  encodeInitCode,
  encodePaymasterAndData,
  estimatePreVerificationGas,
  getUserOpHash,
  packAccountGasLimits,
  packGasFees,
  packUint128Pair,
  packUserOperation,
  requiredGas,
  requiredPrefund,
  unpackAccountGasLimits,
  unpackGasFees,
  unpackUint128Pair,
  type UserOperationDraft,
} from './user-operation';

/**
 * The v0.7 wire format, pinned.
 *
 * WHY THESE TESTS ARE THE ONES THAT MATTER. Every failure mode this module has
 * is silent. Swap the halves of `accountGasLimits` and the operation is still
 * well-formed ABI; write `paymasterAndData` the v0.6 way and the EntryPoint
 * reads the first 32 bytes of the data as two gas limits; get one byte of the
 * hash preimage wrong and a perfectly good WebAuthn assertion comes back as
 * `SIG_VALIDATION_FAILED`, which is one bit and names nothing.
 *
 * THE FIXTURES ARE NOT THIS REPOSITORY'S OPINION. The three `userOpHash` values
 * below were READ FROM THE DEPLOYED ENTRYPOINT: `getUserOpHash` called as a
 * free `eth_call` against 0x0000000071727De22E5E9d8BAf0edAc6f37da032 on
 * Avalanche Fuji (chain 43113, RPC avalanche-fuji-c-chain-rpc.publicnode.com)
 * on 13/09/2026. Nothing was deployed and nothing was broadcast to record them.
 *
 * That is the difference between a test and a tautology. A local
 * reimplementation of a consensus-critical digest, checked only against itself,
 * agrees with its own mistake. `entry-point-hash.live.test.ts` re-asks the
 * contract on demand; this file is what runs offline, on every commit.
 */

const REGISTRY = '0xD5F2d5aD03703a9Ee11078d86181421E2E078365' as Address;
const PRACTITIONER = '0x4429d872fB9253C8516AE525b03cE06FbbbEC143' as Address;
const PHARMACY = '0x7b33436643a681262562785C02Cba36524491042' as Address;
const FUJI_CHAIN_ID = 43113;

const CREDENTIAL_UID = `0x${'11'.repeat(32)}` as Hex;
const FACTORY = `0x${'99'.repeat(20)}` as Address;
const PAYMASTER = `0x${'88'.repeat(20)}` as Address;

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

/** `execute(registry, 0, registerCredential(uid))` — the first operation of an account's life. */
const REGISTER_CALL_DATA = encodeFunctionData({
  abi: executeAbi,
  functionName: 'execute',
  args: [
    REGISTRY,
    0n,
    encodeFunctionData({
      abi: prescriptionRegistryAbi,
      functionName: 'registerCredential',
      args: [CREDENTIAL_UID],
    }),
  ],
});

/**
 * The three operations whose hashes were read off the live EntryPoint.
 *
 * They were chosen to move every field that participates in the digest: an
 * all-zero operation, a counterfactual first operation with `initCode` and a
 * paymaster, and a settled account with a non-zero nonce, realistic fees and no
 * paymaster at all.
 */
const LIVE_VECTORS: ReadonlyArray<{ name: string; draft: UserOperationDraft; userOpHash: Hex }> = [
  {
    name: 'an operation with every field at its zero value',
    draft: {
      sender: '0x0000000000000000000000000000000000000001' as Address,
      nonce: 0n,
      initCode: '0x',
      callData: '0x',
      verificationGasLimit: 0n,
      callGasLimit: 0n,
      preVerificationGas: 0n,
      maxPriorityFeePerGas: 0n,
      maxFeePerGas: 0n,
      signature: '0x',
    },
    userOpHash: '0x5442c9227fd8e33d317fa877da32d6c5c7343e3aa8efab968a3597bc00c5625f',
  },
  {
    name: 'a counterfactual first operation, with initCode and a paymaster',
    draft: {
      sender: PRACTITIONER,
      nonce: 0n,
      initCode: `0x${'99'.repeat(20)}deadbeef`,
      callData: REGISTER_CALL_DATA,
      verificationGasLimit: 1_500_000n,
      callGasLimit: 150_000n,
      preVerificationGas: 60_000n,
      maxPriorityFeePerGas: 150n,
      maxFeePerGas: 1_000n,
      paymaster: {
        address: PAYMASTER,
        verificationGasLimit: 150_000n,
        postOpGasLimit: 0n,
      },
      signature: '0xabcd',
    },
    userOpHash: '0xb9b0549603958c9c641fd361320a41960dd53fbd253a0c2f9760dadaae4e7fa1',
  },
  {
    name: 'a settled account paying its own gas',
    draft: {
      sender: PHARMACY,
      nonce: 7n,
      initCode: '0x',
      callData: REGISTER_CALL_DATA,
      verificationGasLimit: 450_000n,
      callGasLimit: 250_000n,
      preVerificationGas: 55_000n,
      maxPriorityFeePerGas: 1_500_000_000n,
      maxFeePerGas: 30_000_000_000n,
      signature: '0x',
    },
    userOpHash: '0x03545aa36d63e473cc1c06a2904f6669aae17f666a050fc7db1bb552d008de31',
  },
];

describe('the userOpHash this module computes is the one the EntryPoint computes', () => {
  for (const vector of LIVE_VECTORS) {
    it(`matches the deployed EntryPoint for ${vector.name}`, () => {
      expect(
        getUserOpHash({
          userOp: packUserOperation(vector.draft),
          entryPoint: ENTRY_POINT_V07_ADDRESS,
          chainId: FUJI_CHAIN_ID,
        }),
      ).toBe(vector.userOpHash);
    });
  }

  /**
   * The one property the whole signing flow rests on: the hash exists before
   * the signature does. If `signature` were part of the preimage there would be
   * no digest to hand the authenticator.
   */
  it('does not cover the signature, so an operation can be signed at all', () => {
    const [, counterfactual] = LIVE_VECTORS;
    const draft = counterfactual!.draft;

    expect(
      getUserOpHash({
        userOp: packUserOperation({ ...draft, signature: '0x' }),
        chainId: FUJI_CHAIN_ID,
      }),
    ).toBe(
      getUserOpHash({
        userOp: packUserOperation({ ...draft, signature: PLACEHOLDER_ASSERTION_SIGNATURE }),
        chainId: FUJI_CHAIN_ID,
      }),
    );
  });

  /** The two bindings that make a signature un-replayable. */
  it('changes with the chain id', () => {
    const userOp = packUserOperation(LIVE_VECTORS[0]!.draft);

    expect(getUserOpHash({ userOp, chainId: 43113 })).not.toBe(
      getUserOpHash({ userOp, chainId: 31337 }),
    );
  });

  it('changes with the EntryPoint address', () => {
    const userOp = packUserOperation(LIVE_VECTORS[0]!.draft);

    expect(getUserOpHash({ userOp, chainId: FUJI_CHAIN_ID })).not.toBe(
      getUserOpHash({
        userOp,
        entryPoint: '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789' as Address,
        chainId: FUJI_CHAIN_ID,
      }),
    );
  });

  it('defaults to EntryPoint v0.7', () => {
    const userOp = packUserOperation(LIVE_VECTORS[0]!.draft);

    expect(getUserOpHash({ userOp, chainId: FUJI_CHAIN_ID })).toBe(
      getUserOpHash({ userOp, entryPoint: ENTRY_POINT_V07_ADDRESS, chainId: FUJI_CHAIN_ID }),
    );
  });

  /** Every field in the preimage has to move the answer, or it is not in it. */
  it.each<[string, Partial<UserOperationDraft>]>([
    ['sender', { sender: PHARMACY }],
    ['nonce', { nonce: 1n }],
    ['initCode', { initCode: '0xdeadbeef' }],
    ['callData', { callData: '0xdeadbeef' }],
    ['verificationGasLimit', { verificationGasLimit: 1n }],
    ['callGasLimit', { callGasLimit: 1n }],
    ['preVerificationGas', { preVerificationGas: 1n }],
    ['maxPriorityFeePerGas', { maxPriorityFeePerGas: 1n }],
    ['maxFeePerGas', { maxFeePerGas: 1n }],
    [
      'paymasterAndData',
      { paymaster: { address: PAYMASTER, verificationGasLimit: 1n, postOpGasLimit: 0n } },
    ],
  ])('changes when %s changes', (_field, patch) => {
    const base = LIVE_VECTORS[0]!.draft;

    expect(getUserOpHash({ userOp: packUserOperation(base), chainId: FUJI_CHAIN_ID })).not.toBe(
      getUserOpHash({ userOp: packUserOperation({ ...base, ...patch }), chainId: FUJI_CHAIN_ID }),
    );
  });
});

describe('accountGasLimits: verification high, call low', () => {
  /**
   * Read off the live vector above: 0x16e360 is 1_500_000 and 0x249f0 is
   * 150_000, in that order. This is the assertion that catches the swap.
   */
  it('lays the two limits out the way the EntryPoint reads them', () => {
    expect(packAccountGasLimits({ verificationGasLimit: 1_500_000n, callGasLimit: 150_000n })).toBe(
      '0x0000000000000000000000000016e360000000000000000000000000000249f0',
    );
  });

  it('is not symmetric, so a swap produces different bytes', () => {
    expect(packAccountGasLimits({ verificationGasLimit: 450_000n, callGasLimit: 250_000n })).not.toBe(
      packAccountGasLimits({ verificationGasLimit: 250_000n, callGasLimit: 450_000n }),
    );
  });

  it('round trips', () => {
    const limits = { verificationGasLimit: 450_000n, callGasLimit: 250_000n };

    expect(unpackAccountGasLimits(packAccountGasLimits(limits))).toEqual(limits);
  });

  it('refuses a limit that does not fit in 128 bits', () => {
    expect(() =>
      packAccountGasLimits({ verificationGasLimit: 1n << 128n, callGasLimit: 0n }),
    ).toThrow(UserOperationEncodingError);
  });
});

describe('gasFees: priority high, max low — the other way round from the limits', () => {
  /** 0x59682f00 is 1_500_000_000; 0x6fc23ac00 is 30_000_000_000. */
  it('lays the two fees out the way the EntryPoint reads them', () => {
    expect(
      packGasFees({ maxPriorityFeePerGas: 1_500_000_000n, maxFeePerGas: 30_000_000_000n }),
    ).toBe('0x00000000000000000000000059682f00000000000000000000000006fc23ac00');
  });

  it('puts the SMALLER fee in the high half, unlike accountGasLimits', () => {
    const fees = packGasFees({ maxPriorityFeePerGas: 1n, maxFeePerGas: 2n });

    expect(unpackUint128Pair(fees)).toEqual({ high: 1n, low: 2n });
  });

  it('round trips', () => {
    const fees = { maxPriorityFeePerGas: 150n, maxFeePerGas: 1_000n };

    expect(unpackGasFees(packGasFees(fees))).toEqual(fees);
  });
});

describe('packUint128Pair', () => {
  it('produces exactly 32 bytes', () => {
    expect(size(packUint128Pair(1n, 1n))).toBe(32);
  });

  it('keeps the halves independent at the boundary', () => {
    const word = packUint128Pair((1n << 128n) - 1n, 0n);

    expect(word).toBe('0xffffffffffffffffffffffffffffffff00000000000000000000000000000000');
    expect(unpackUint128Pair(word)).toEqual({ high: (1n << 128n) - 1n, low: 0n });
  });

  it('refuses a negative value', () => {
    expect(() => packUint128Pair(-1n, 0n)).toThrow(UserOperationEncodingError);
  });
});

describe('paymasterAndData: 20 + 16 + 16 + data', () => {
  /** Read off the live vector: 0x249f0 is 150_000, then sixteen zero bytes. */
  it('writes the header the EntryPoint parses', () => {
    expect(
      encodePaymasterAndData({
        address: PAYMASTER,
        verificationGasLimit: 150_000n,
        postOpGasLimit: 0n,
      }),
    ).toBe(
      '0x8888888888888888888888888888888888888888000000000000000000000000000249f000000000000000000000000000000000',
    );
  });

  it('is 52 bytes with no trailing data', () => {
    expect(
      size(
        encodePaymasterAndData({
          address: PAYMASTER,
          verificationGasLimit: 150_000n,
          postOpGasLimit: 0n,
        }),
      ),
    ).toBe(PAYMASTER_DATA_OFFSET);
  });

  it('appends data after the header, never inside it', () => {
    const encoded = encodePaymasterAndData({
      address: PAYMASTER,
      verificationGasLimit: 150_000n,
      postOpGasLimit: 1n,
      data: '0xdeadbeef',
    });

    expect(size(encoded)).toBe(PAYMASTER_DATA_OFFSET + 4);
    expect(decodePaymasterAndData(encoded)).toEqual({
      address: PAYMASTER.toLowerCase(),
      verificationGasLimit: 150_000n,
      postOpGasLimit: 1n,
      data: '0xdeadbeef',
    });
  });

  it('is empty when nobody is sponsoring', () => {
    expect(encodePaymasterAndData(undefined)).toBe('0x');
    expect(decodePaymasterAndData('0x')).toBeUndefined();
  });

  /**
   * THE v0.6 SHAPE, REFUSED. A bare paymaster address was a valid
   * `paymasterAndData` under v0.6 and is a truncated header under v0.7.
   * Returning a half-filled object here would move the failure one layer away
   * from its cause, which for this field means an opaque `AA` code.
   */
  it('refuses a bare paymaster address, which is the v0.6 shape', () => {
    expect(() => decodePaymasterAndData(PAYMASTER)).toThrow(UserOperationEncodingError);
  });

  it('refuses a header that is one byte short', () => {
    expect(() => decodePaymasterAndData(`0x${'88'.repeat(PAYMASTER_DATA_OFFSET - 1)}`)).toThrow(
      /too short for the v0.7 header/,
    );
  });

  it('refuses an address that is not 20 bytes', () => {
    expect(() =>
      encodePaymasterAndData({
        address: '0x8888' as Address,
        verificationGasLimit: 0n,
        postOpGasLimit: 0n,
      }),
    ).toThrow(UserOperationEncodingError);
  });
});

describe('initCode', () => {
  it('is the factory address followed by its calldata', () => {
    const initCode = encodeInitCode(FACTORY, 1n, 2n);

    expect(initCode.slice(0, 42).toLowerCase()).toBe(FACTORY.toLowerCase());
    // 20 bytes of factory, 4 of selector, two 32-byte coordinates.
    expect(size(initCode)).toBe(20 + 4 + 64);
  });

  it('commits to the public key, so two passkeys never share an initCode', () => {
    expect(encodeInitCode(FACTORY, 1n, 2n)).not.toBe(encodeInitCode(FACTORY, 1n, 3n));
  });
});

describe('what the operation costs', () => {
  const draft: UserOperationDraft = {
    sender: PRACTITIONER,
    nonce: 0n,
    initCode: '0x',
    callData: REGISTER_CALL_DATA,
    verificationGasLimit: 450_000n,
    callGasLimit: 250_000n,
    preVerificationGas: 55_000n,
    maxPriorityFeePerGas: 150n,
    maxFeePerGas: 1_000n,
    paymaster: { address: PAYMASTER, verificationGasLimit: 150_000n, postOpGasLimit: 0n },
    signature: '0x',
  };

  /**
   * `_getRequiredPrefund` from EntryPoint v0.7, which is the `maxCost` argument
   * `PrescriptionPaymaster.validatePaymasterUserOp` compares against
   * `maxCostPerOp`. Every field counts, the paymaster's two included.
   */
  it('adds up every gas field, including the paymaster’s', () => {
    expect(requiredGas(draft)).toBe(450_000n + 250_000n + 55_000n + 150_000n);
  });

  it('prices the prefund at maxFeePerGas, not at the priority fee', () => {
    expect(requiredPrefund(draft)).toBe(requiredGas(draft) * 1_000n);
  });

  it('counts nothing for a paymaster that is not there', () => {
    expect(requiredGas({ ...draft, paymaster: undefined })).toBe(450_000n + 250_000n + 55_000n);
  });
});

describe('preVerificationGas is measured from the operation that will actually be sent', () => {
  const base: UserOperationDraft = {
    sender: PRACTITIONER,
    nonce: 0n,
    initCode: '0x',
    callData: REGISTER_CALL_DATA,
    verificationGasLimit: 450_000n,
    callGasLimit: 250_000n,
    preVerificationGas: 0n,
    maxPriorityFeePerGas: 150n,
    maxFeePerGas: 1_000n,
    paymaster: { address: PAYMASTER, verificationGasLimit: 150_000n, postOpGasLimit: 0n },
    signature: PLACEHOLDER_ASSERTION_SIGNATURE,
  };

  const beneficiary = PHARMACY;

  it('covers at least the 21000 every transaction pays', () => {
    expect(estimatePreVerificationGas({ draft: base, beneficiary })).toBeGreaterThan(21_000n);
  });

  /**
   * THE MISTAKE THIS EXISTS TO PREVENT. Sizing against an empty signature and
   * then signing a 512-byte WebAuthn envelope under-budgets the calldata by
   * more than 8000 gas, and the operation is refused for a reason that has
   * nothing to do with the signature being wrong.
   */
  it('is materially larger with a real-sized assertion than with an empty signature', () => {
    const withEnvelope = estimatePreVerificationGas({ draft: base, beneficiary });
    const withoutEnvelope = estimatePreVerificationGas({
      draft: { ...base, signature: '0x' },
      beneficiary,
    });

    expect(withEnvelope - withoutEnvelope).toBeGreaterThan(4_000n);
  });

  it('grows when the first operation carries initCode', () => {
    const deploying = estimatePreVerificationGas({
      draft: { ...base, initCode: encodeInitCode(FACTORY, 12345n, 67890n) },
      beneficiary,
    });

    expect(deploying).toBeGreaterThan(estimatePreVerificationGas({ draft: base, beneficiary }));
  });

  /**
   * The second pass is the fixed point: feeding the answer back in does not
   * move it. That is what makes the estimate deterministic rather than an
   * arbitrary stopping point in a loop.
   */
  it('is a fixed point, so feeding it back changes nothing', () => {
    const first = estimatePreVerificationGas({ draft: base, beneficiary });
    const second = estimatePreVerificationGas({
      draft: { ...base, preVerificationGas: first },
      beneficiary,
    });

    expect(second).toBe(first);
  });

  it('charges less for zero bytes than for non-zero ones', () => {
    const zeros = estimatePreVerificationGas({
      draft: { ...base, signature: `0x${'00'.repeat(512)}` },
      beneficiary,
    });
    const nonZeros = estimatePreVerificationGas({
      draft: { ...base, signature: `0x${'ff'.repeat(512)}` },
      beneficiary,
    });

    expect(nonZeros).toBeGreaterThan(zeros);
  });
});

describe('the placeholder assertion', () => {
  /**
   * `contracts/src/WebAuthn.sol` quotes "a 512-byte envelope" for the shape it
   * decodes. The placeholder has to be at least that, because its whole job is
   * to make the gas estimate answer about the real operation.
   */
  it('is the size of a real WebAuthn envelope', () => {
    expect(size(PLACEHOLDER_ASSERTION_SIGNATURE)).toBeGreaterThanOrEqual(512);
  });

  /**
   * EVERY ZERO BYTE IN IT IS ABI PADDING, never payload — the same padding a
   * real envelope carries, in the same places: the offset words, the two length
   * words, and the tails that round `authenticatorData` and `clientDataJSON` up
   * to whole words.
   *
   * This matters because zero calldata bytes cost 4 gas and non-zero ones cost
   * 16. A placeholder that was an all-zero buffer of the right length would
   * under-price the real operation by roughly 6000 gas, and the estimate would
   * be wrong in the direction that makes the EntryPoint refuse it.
   */
  it('carries real payload in every field, so it never under-prices the real one', () => {
    expect(PLACEHOLDER_ASSERTION_SIGNATURE).toContain('ab'.repeat(37));
    expect(PLACEHOLDER_ASSERTION_SIGNATURE).toContain('cd'.repeat(136));
  });

  it('is not an all-zero buffer wearing the right length', () => {
    const bytes = PLACEHOLDER_ASSERTION_SIGNATURE.slice(2);
    let zeros = 0;

    for (let i = 0; i < bytes.length; i += 2) {
      if (bytes.slice(i, i + 2) === '00') zeros += 1;
    }

    expect(zeros).toBeLessThan(size(PLACEHOLDER_ASSERTION_SIGNATURE) * 0.6);
  });
});

describe('handleOps calldata', () => {
  it('carries the beneficiary the EntryPoint reimburses', () => {
    const calldata = encodeHandleOps([packUserOperation(LIVE_VECTORS[0]!.draft)], PRACTITIONER);

    expect(calldata.toLowerCase()).toContain(PRACTITIONER.slice(2).toLowerCase());
  });
});
