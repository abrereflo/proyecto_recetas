import { numberToHex } from 'viem';
import type { Address } from '@recetas/shared';
import {
  SignerRejectedError,
  SignerUnavailableError,
  type SignerPort,
} from '../../ports/signer.port';

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

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

/** Error code EIP-1193 reserves for "the user said no". */
const USER_REJECTED = 4001;
/** Error code EIP-3085/1193 returns when the chain is not known to the provider. */
const UNRECOGNISED_CHAIN = 4902;

declare global {
  interface Window {
    ethereum?: Eip1193Provider;
  }
}

export function injectedProvider(): Eip1193Provider | undefined {
  return typeof globalThis.window === 'undefined' ? undefined : globalThis.window.ethereum;
}

function errorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'number' ? code : undefined;
}

function firstAddress(value: unknown): Address | null {
  if (!Array.isArray(value)) return null;
  const [first] = value as unknown[];
  return typeof first === 'string' ? (first as Address) : null;
}

export interface Eip1193SignerOptions {
  /** Resolved lazily so a provider injected after load is still picked up. */
  getProvider?: () => Eip1193Provider | undefined;
}

export function createEip1193Signer(options: Eip1193SignerOptions = {}): SignerPort {
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
        await provider.request({
          method: 'wallet_switchEthereumChain',
          params: [{ chainId: numberToHex(chainId) }],
        });
      } catch (error) {
        const code = errorCode(error);
        if (code === USER_REJECTED) throw new SignerRejectedError({ cause: error });
        if (code === UNRECOGNISED_CHAIN) {
          throw new Error(
            `El dispositivo no tiene configurada la cadena ${chainId}, que es donde está ` +
              'registrado el sistema de recetas.',
          );
        }
        throw error;
      }
    },
  };
}
