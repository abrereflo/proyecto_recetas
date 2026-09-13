import { numberToHex } from 'viem';
import { addEthereumChainParams } from '@recetas/chain';
import type { Address } from '@recetas/shared';
import {
  SignerRejectedError,
  SignerUnavailableError,
  type Eip1193Provider,
  type SignerPort,
} from '../../ports/signer.port';
import type { PharmacyConfig } from '../config/env';
import { USER_REJECTED, UNRECOGNISED_CHAIN, errorCode } from '../eip1193-errors';

/**
 * `SignerPort` over the browser's injected EIP-1193 provider.
 *
 * HARD RULE (docs/01, docs/17): the interface never says "wallet", "frase
 * semilla" or "saldo". `window.ethereum` and `wallet_switchEthereumChain` are
 * protocol identifiers that stay inside this file; every message this adapter
 * throws is already written in the language the counter reads.
 *
 * TODO (docs/01, D-04): the pilot replaces this with an ERC-4337 smart account
 * backed by a passkey, so the pharmacist never handles a key at all. The port
 * boundary is what makes that swap a one-file change.
 */

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function injectedProvider(): Eip1193Provider | undefined {
  return typeof globalThis.window === 'undefined' ? undefined : globalThis.window.ethereum;
}

function firstAddress(value: unknown): Address | null {
  if (!Array.isArray(value)) return null;
  const [first] = value as unknown[];
  return typeof first === 'string' ? (first as Address) : null;
}

/** Today's message: the chain the recetas system lives on is not configured. */
function chainNotConfiguredMessage(chainId: number): string {
  return (
    `El dispositivo no tiene configurada la cadena ${chainId}, que es donde está ` +
    'registrado el sistema de recetas.'
  );
}

function switchChain(provider: Eip1193Provider, chainId: number): Promise<unknown> {
  return provider.request({
    method: 'wallet_switchEthereumChain',
    params: [{ chainId: numberToHex(chainId) }],
  });
}

/**
 * Corte 1 (docs/21): the extension answered 4902, so it does not know the
 * chain. Offer `wallet_addEthereumChain` with the parameters `buildChain`
 * already derives from configuration, then retry the switch exactly once.
 */
async function addChainThenRetrySwitch(
  provider: Eip1193Provider,
  chainId: number,
  config: PharmacyConfig,
): Promise<void> {
  try {
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [addEthereumChainParams({ chainId, rpcUrl: config.rpcUrl })],
    });
  } catch (error) {
    if (errorCode(error) === USER_REJECTED) throw new SignerRejectedError({ cause: error });
    throw new Error(chainNotConfiguredMessage(chainId));
  }

  try {
    await switchChain(provider, chainId);
  } catch (error) {
    if (errorCode(error) === USER_REJECTED) throw new SignerRejectedError({ cause: error });
    throw new Error(chainNotConfiguredMessage(chainId));
  }
}

export interface Eip1193SignerOptions {
  config: PharmacyConfig;
  /** Resolved lazily so a provider injected after load is still picked up. */
  getProvider?: () => Eip1193Provider | undefined;
}

export function createEip1193Signer(options: Eip1193SignerOptions): SignerPort {
  const { config } = options;
  const getProvider = options.getProvider ?? injectedProvider;

  const require = (): Eip1193Provider => {
    const provider = getProvider();
    if (provider === undefined) throw new SignerUnavailableError();
    return provider;
  };

  return {
    isAvailable() {
      return getProvider() !== undefined;
    },

    getProvider,

    async getAccount() {
      const provider = getProvider();
      if (provider === undefined) return null;
      return firstAddress(await provider.request({ method: 'eth_accounts' }));
    },

    async connect() {
      const provider = require();
      try {
        const account = firstAddress(await provider.request({ method: 'eth_requestAccounts' }));
        if (account === null) throw new SignerUnavailableError();
        return account;
      } catch (error) {
        if (errorCode(error) === USER_REJECTED) throw new SignerRejectedError({ cause: error });
        throw error;
      }
    },

    async getChainId() {
      const raw = await require().request({ method: 'eth_chainId' });
      return typeof raw === 'string' ? Number.parseInt(raw, 16) : Number(raw);
    },

    async ensureChain(chainId) {
      const provider = require();
      const current = await provider.request({ method: 'eth_chainId' });
      if (typeof current === 'string' && Number.parseInt(current, 16) === chainId) return;

      try {
        await switchChain(provider, chainId);
      } catch (error) {
        const code = errorCode(error);
        if (code === USER_REJECTED) throw new SignerRejectedError({ cause: error });
        if (code !== UNRECOGNISED_CHAIN) throw error;

        // The extension does not know this chain yet (EIP-3085): offer to add
        // it, once, and retry the switch, once. Anything else — the person
        // declining the add prompt, the add failing, or the retried switch
        // failing again — falls back to today's message.
        await addChainThenRetrySwitch(provider, chainId, config);
      }
    },
  };
}
