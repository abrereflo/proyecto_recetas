import { describe, expect, it } from 'vitest';
import { encodeErrorResult } from 'viem';
import { entryPointV07Abi, prescriptionRegistryAbi } from '@recetas/chain';
import type { Address, Hex } from '@recetas/shared';
import {
  decodeHandleOpsFailure,
  decodeInnerFailure,
  passkeyAccountErrorsAbi,
  prescriptionPaymasterErrorsAbi,
} from './failures';

/**
 * Fase 5 item 8 only reaches a screen if somebody decodes `inner`.
 *
 * `PrescriptionPaymaster` reverts rather than returning `validationData = 1`
 * precisely so that `FailedOpWithRevert(opIndex, "AA33 reverted", inner)`
 * carries its own error with its arguments — `SponsorshipExhausted(account,
 * used, limit, windowEndsAt)`, with the moment sponsorship comes back. Returning
 * `1` would have produced "AA34 signature error", a fixed string about
 * something that is not a signature.
 */

const ACCOUNT = '0x4429d872fB9253C8516AE525b03cE06FbbbEC143' as Address;
const REGISTRY = '0xD5F2d5aD03703a9Ee11078d86181421E2E078365' as Address;
const PHARMACY = '0x7b33436643a681262562785C02Cba36524491042' as Address;
const CONTENT_HASH = `0x${'11'.repeat(32)}` as Hex;

function paymasterRevert(errorName: string, args: readonly unknown[]): Hex {
  return encodeErrorResult({ abi: prescriptionPaymasterErrorsAbi, errorName, args } as never);
}

function wrapped(inner: Hex): Hex {
  return encodeErrorResult({
    abi: entryPointV07Abi,
    errorName: 'FailedOpWithRevert',
    args: [0n, 'AA33 reverted', inner],
  });
}

describe('the message Fase 5 item 8 asks for', () => {
  it('recovers SponsorshipExhausted with all four arguments', () => {
    const inner = paymasterRevert('SponsorshipExhausted', [ACCOUNT, 40, 40, 1_757_600_000n]);

    expect(decodeHandleOpsFailure(wrapped(inner))).toEqual({
      entryPointReason: 'AA33 reverted',
      opIndex: 0n,
      source: 'paymaster',
      name: 'SponsorshipExhausted',
      args: { account: ACCOUNT, used: 40, limit: 40, windowEndsAt: 1_757_600_000n },
      data: inner,
    });
  });

  /**
   * `windowEndsAt` is the argument that turns "se acabó" into "el patrocinio se
   * renueva a las 14:32". Losing it would make the revert channel worth no more
   * than the `validationData = 1` the contract deliberately rejected.
   */
  it('keeps windowEndsAt, which is the whole reason the contract reverts', () => {
    const decoded = decodeHandleOpsFailure(
      wrapped(paymasterRevert('SponsorshipExhausted', [ACCOUNT, 40, 40, 1_757_600_000n])),
    );

    expect(decoded.args?.windowEndsAt).toBe(1_757_600_000n);
  });
});

describe('every paymaster rule comes back named', () => {
  it.each<[string, readonly unknown[]]>([
    ['NotAccredited', [ACCOUNT]],
    ['CostNotSponsored', [10n ** 18n, 20_000_000_000_000_000n]],
    ['TargetNotSponsored', [PHARMACY, REGISTRY]],
    ['ValueNotSponsored', [1n]],
    ['UnsupportedSelector', ['0xdeadbeef']],
    ['UnsupportedCallData', [3n]],
    ['InvalidPolicy', []],
  ])('%s', (errorName, args) => {
    const decoded = decodeHandleOpsFailure(wrapped(paymasterRevert(errorName, args)));

    expect(decoded.source).toBe('paymaster');
    expect(decoded.name).toBe(errorName);
  });
});

describe('an account error survives the trip too', () => {
  it('names TargetNotAllowed with both addresses', () => {
    const inner = encodeErrorResult({
      abi: passkeyAccountErrorsAbi,
      errorName: 'TargetNotAllowed',
      args: [PHARMACY, REGISTRY],
    });

    expect(decodeInnerFailure(inner)).toEqual({
      source: 'account',
      name: 'TargetNotAllowed',
      args: { target: PHARMACY, allowed: REGISTRY },
      data: inner,
    });
  });
});

/**
 * `PasskeyAccount.execute` re-throws the registry's error verbatim, on purpose,
 * so `AlreadyDispensed(hash, who, when)` survives the trip — it is what the
 * pharmacy screen reads, and collapsing it would erase the message the product
 * is built around.
 */
describe('a registry error reaches the caller with its arguments', () => {
  it('names AlreadyDispensed and keeps who and when', () => {
    const inner = encodeErrorResult({
      abi: prescriptionRegistryAbi,
      errorName: 'AlreadyDispensed',
      args: [CONTENT_HASH, PHARMACY, 1_757_600_000n],
    });

    const decoded = decodeInnerFailure(inner);

    expect(decoded.source).toBe('registry');
    expect(decoded.name).toBe('AlreadyDispensed');
    expect(decoded.args).toMatchObject({ dispensedBy: PHARMACY, dispensedAt: 1_757_600_000n });
  });
});

describe('the fixed-string channel', () => {
  it('carries the AAxx reason and admits it has no arguments', () => {
    const data = encodeErrorResult({
      abi: entryPointV07Abi,
      errorName: 'FailedOp',
      args: [0n, 'AA34 signature error'],
    });

    expect(decodeHandleOpsFailure(data)).toEqual({
      entryPointReason: 'AA34 signature error',
      opIndex: 0n,
      source: 'entry-point',
      name: 'FailedOp',
      data,
    });
  });
});

describe('nothing is invented out of a failure nobody modelled', () => {
  it('reports unknown for bytes that decode to nothing', () => {
    expect(decodeHandleOpsFailure('0xdeadbeef')).toEqual({ source: 'unknown', data: '0xdeadbeef' });
  });

  it('reports unknown for an empty revert', () => {
    expect(decodeHandleOpsFailure('0x')).toEqual({ source: 'unknown' });
    expect(decodeHandleOpsFailure(undefined)).toEqual({ source: 'unknown' });
  });

  it('always keeps the raw bytes, so nothing is lost in translation', () => {
    const inner = paymasterRevert('NotAccredited', [ACCOUNT]);

    expect(decodeHandleOpsFailure(wrapped(inner)).data).toBe(inner);
  });
});
