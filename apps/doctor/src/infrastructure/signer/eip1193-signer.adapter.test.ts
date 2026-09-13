import { describe, expect, it, vi } from 'vitest';
import { addEthereumChainParams } from '@recetas/chain';
import { CONFIG } from '../../test/fixtures';
import { SignerRejectedError, type Eip1193Provider } from '../../ports/signer.port';
import { errorCode } from '../eip1193-errors';
import { createEip1193Signer } from './eip1193-signer.adapter';

/**
 * Corte 1 (docs/21-acceso-para-la-demo.md): `ensureChain` no longer gives up
 * the moment the extension answers 4902 ("chain not configured"). It now
 * offers `wallet_addEthereumChain` once and retries the switch once, and only
 * a genuine second failure — or a decline — falls back to today's message.
 */

const UNRECOGNISED_CHAIN = 4902;
const USER_REJECTED = 4001;
const NOT_CONNECTED = 4900;
const NOT_CONFIGURED_MESSAGE =
  `El dispositivo no tiene configurada la cadena ${CONFIG.chainId}, que es donde está ` +
  'registrado el sistema de recetas.';

function providerRejecting(
  switchResults: Array<() => Promise<unknown>>,
  addChain?: () => Promise<unknown>,
): { provider: Eip1193Provider; calls: string[] } {
  const calls: string[] = [];
  let switchAttempt = 0;

  const provider: Eip1193Provider = {
    request: vi.fn(async ({ method }: { method: string }) => {
      calls.push(method);

      if (method === 'eth_chainId') return '0x1';

      if (method === 'wallet_switchEthereumChain') {
        const outcome = switchResults[switchAttempt];
        switchAttempt += 1;
        if (outcome === undefined) throw new Error('unexpected extra switch attempt');
        return outcome();
      }

      if (method === 'wallet_addEthereumChain') {
        if (addChain === undefined) throw new Error('wallet_addEthereumChain was not expected');
        return addChain();
      }

      throw new Error(`unexpected method ${method}`);
    }),
  };

  return { provider, calls };
}

function signerWith(provider: Eip1193Provider) {
  return createEip1193Signer({ config: CONFIG, getProvider: () => provider });
}

describe('ensureChain — the 4902 fallback (Corte 1)', () => {
  it('adds the chain and retries the switch once when the provider answers 4902', async () => {
    const { provider, calls } = providerRejecting(
      [() => Promise.reject({ code: UNRECOGNISED_CHAIN }), () => Promise.resolve(null)],
      () => Promise.resolve(null),
    );

    await expect(signerWith(provider).ensureChain(CONFIG.chainId)).resolves.toBeUndefined();

    expect(calls).toEqual([
      'eth_chainId',
      'wallet_switchEthereumChain',
      'wallet_addEthereumChain',
      'wallet_switchEthereumChain',
    ]);
  });

  it('requests wallet_addEthereumChain with hex chainId and the params derived from buildChain', async () => {
    let addChainParams: unknown;
    let switchAttempts = 0;

    const provider: Eip1193Provider = {
      request: vi.fn(async (args: { method: string; params?: unknown }) => {
        if (args.method === 'eth_chainId') return '0x1';

        if (args.method === 'wallet_switchEthereumChain') {
          switchAttempts += 1;
          if (switchAttempts === 1) throw { code: UNRECOGNISED_CHAIN };
          return null;
        }

        if (args.method === 'wallet_addEthereumChain') {
          addChainParams = (args.params as unknown[])[0];
          return null;
        }

        throw new Error(`unexpected method ${args.method}`);
      }),
    };

    await signerWith(provider).ensureChain(CONFIG.chainId);

    expect(addChainParams).toEqual(addEthereumChainParams(CONFIG));
  });

  it('never calls wallet_addEthereumChain when the switch fails for any other reason', async () => {
    const originalError = { code: NOT_CONNECTED, message: 'not connected' };
    const { provider, calls } = providerRejecting([() => Promise.reject(originalError)]);

    await expect(signerWith(provider).ensureChain(CONFIG.chainId)).rejects.toBe(originalError);
    expect(calls).not.toContain('wallet_addEthereumChain');
  });

  it('still reports a declined switch as SignerRejectedError, unchanged', async () => {
    const { provider } = providerRejecting([() => Promise.reject({ code: USER_REJECTED })]);

    await expect(signerWith(provider).ensureChain(CONFIG.chainId)).rejects.toBeInstanceOf(
      SignerRejectedError,
    );
  });

  it('reports a declined wallet_addEthereumChain prompt as SignerRejectedError, not the raw provider error', async () => {
    const { provider } = providerRejecting(
      [() => Promise.reject({ code: UNRECOGNISED_CHAIN })],
      () => Promise.reject({ code: USER_REJECTED }),
    );

    await expect(signerWith(provider).ensureChain(CONFIG.chainId)).rejects.toBeInstanceOf(
      SignerRejectedError,
    );
  });

  it('falls back to the unconfigured-chain message when wallet_addEthereumChain fails for any other reason', async () => {
    const { provider } = providerRejecting(
      [() => Promise.reject({ code: UNRECOGNISED_CHAIN })],
      () => Promise.reject(new Error('extension crashed')),
    );

    await expect(signerWith(provider).ensureChain(CONFIG.chainId)).rejects.toThrow(
      NOT_CONFIGURED_MESSAGE,
    );
  });

  it('falls back to the unconfigured-chain message when the retried switch fails again', async () => {
    const { provider } = providerRejecting(
      [
        () => Promise.reject({ code: UNRECOGNISED_CHAIN }),
        () => Promise.reject({ code: UNRECOGNISED_CHAIN }),
      ],
      () => Promise.resolve(null),
    );

    await expect(signerWith(provider).ensureChain(CONFIG.chainId)).rejects.toThrow(
      NOT_CONFIGURED_MESSAGE,
    );
  });

  it('retries the switch at most once — no unbounded loop', async () => {
    let switchCalls = 0;
    const provider: Eip1193Provider = {
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === 'eth_chainId') return '0x1';
        if (method === 'wallet_switchEthereumChain') {
          switchCalls += 1;
          throw { code: UNRECOGNISED_CHAIN };
        }
        if (method === 'wallet_addEthereumChain') return null;
        throw new Error(`unexpected method ${method}`);
      }),
    };

    await expect(signerWith(provider).ensureChain(CONFIG.chainId)).rejects.toThrow(
      NOT_CONFIGURED_MESSAGE,
    );
    expect(switchCalls).toBe(2);
  });
});

describe('errorCode — walking the cause chain (already recursive here)', () => {
  it('finds a code wrapped one level deep in cause', () => {
    expect(errorCode({ cause: { code: UNRECOGNISED_CHAIN } })).toBe(UNRECOGNISED_CHAIN);
  });
});
