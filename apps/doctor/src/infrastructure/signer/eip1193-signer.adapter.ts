import { createWalletClient, custom, numberToHex, type Address as ViemAddress } from 'viem';
import { buildChain, domainFor } from '@recetas/chain';
import {
  PRESCRIPTION_EIP712_TYPES,
  PRESCRIPTION_PRIMARY_TYPE,
  type Address,
  type Hex,
} from '@recetas/shared';
import {
  SignerRejectedError,
  SignerUnavailableError,
  type SignerPort,
  type SignPrescriptionInput,
} from '../../ports/signer.port';
import type { DoctorConfig } from '../config/env';

/**
 * `SignerPort` over the browser's injected EIP-1193 provider.
 *
 * Ported from apps/pharmacy/src/infrastructure/signer/eip1193-signer.adapter.ts,
 * which only ever needed to CONNECT. The doctor also has to SIGN: screen D5 is
 * an EIP-712 signature over the prescription message, produced by a key this
 * application never sees.
 *
 * HARD RULE (docs/01, docs/17): the interface never says "wallet", "frase
 * semilla" or "saldo". `window.ethereum` and `wallet_switchEthereumChain` are
 * protocol identifiers that stay inside this file; every message this adapter
 * throws is already written in the language the consulting room reads.
 *
 * HARD RULE (docs/03): the signed message carries no patient identifier and no
 * salt. It is built by `buildMessage` in the application layer and arrives here
 * already typed, so this file has no way to add one.
 *
 * TODO (docs/01, D-04, Fase 5): the pilot replaces this with an ERC-4337 smart
 * account backed by a passkey (screen D1), so the prescriber never handles a key
 * at all. The port boundary is what makes that swap a one-file change.
 */

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

/** Error code EIP-1193 reserves for "the user said no". */
export const USER_REJECTED = 4001;
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

export function errorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'number') return code;
  const cause = (error as { cause?: unknown }).cause;
  return cause === undefined || cause === error ? undefined : errorCode(cause);
}

function firstAddress(value: unknown): Address | null {
  if (!Array.isArray(value)) return null;
  const [first] = value as unknown[];
  return typeof first === 'string' ? (first as Address) : null;
}

export interface Eip1193SignerOptions {
  config: DoctorConfig;
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

    async signPrescription({ prescriber, message }: SignPrescriptionInput): Promise<Hex> {
      const provider = require();

      const walletClient = createWalletClient({
        account: prescriber as ViemAddress,
        chain: buildChain(config),
        transport: custom(provider),
      });

      try {
        // The domain, the type definition and the MVP nonce come from
        // @recetas/chain over @recetas/shared, so this app signs exactly the
        // structure apps/cli signs and apps/pharmacy verifies. Field order is
        // part of the type hash and is never restated here.
        return await walletClient.signTypedData({
          account: prescriber as ViemAddress,
          domain: domainFor({
            chainId: config.chainId,
            registryAddress: config.registryAddress as ViemAddress,
          }),
          types: PRESCRIPTION_EIP712_TYPES,
          primaryType: PRESCRIPTION_PRIMARY_TYPE,
          message,
        });
      } catch (error) {
        // Declining the prompt is a decision, not a failure, and the issuing
        // use case reports it as `aborted` rather than as a rejected receta.
        if (errorCode(error) === USER_REJECTED) throw new SignerRejectedError({ cause: error });
        throw error;
      }
    },
  };
}
