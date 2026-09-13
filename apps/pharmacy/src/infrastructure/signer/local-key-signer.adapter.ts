import { createWalletClient, custom, numberToHex, type Address as ViemAddress } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { buildChain } from '@recetas/chain';
import type { Address } from '@recetas/shared';
import type { DeviceKeyPort } from '../../ports/device-key.port';
import {
  SignerUnavailableError,
  type Eip1193Provider,
  type SignerPort,
} from '../../ports/signer.port';
import type { PharmacyConfig } from '../config/env';
import {
  clearKeystore,
  decryptPrivateKey,
  encryptPrivateKey,
  hasKeystore,
  loadKeystore,
  saveKeystore,
} from './keystore';

/**
 * `SignerPort` over a key this device holds, encrypted, under a passphrase.
 *
 * WHY (docs/23-firma-en-el-dispositivo.md): the injected provider's in-app
 * browser blocks getUserMedia and cannot install a PWA, and the pharmacy app is
 * a scanner first. This adapter lets the counter phone run in plain Safari or
 * Chrome. It is DELIBERATE SCAFFOLDING; D-04's passkey + ERC-4337 account
 * replaces it, and the composition root is still the only file that names it.
 *
 * HARD RULE (docs/01, docs/17): "wallet", "frase semilla" and "saldo" never
 * appear in anything a person reads. The RPC method names below are protocol
 * identifiers in code, never screen copy.
 *
 * WHAT THE DECRYPTED KEY MAY TOUCH: the `account` closure variable below, and
 * nothing else. It is never stored, never logged, never put in React state and
 * never returned from any method. `lock()` drops it.
 */

/**
 * There IS a key on this device and it is closed.
 *
 * DISTINCT FROM `SignerUnavailableError` ON PURPOSE. The access path branches
 * on the difference because the two have different answers:
 *
 *   SignerUnavailableError -> nothing is configured here; someone has to set
 *                             the device up (or the browser has no provider).
 *   SignerLockedError      -> the key is right here; ask for the passphrase.
 *
 * Collapsing them would send a pharmacist who only forgot to type a passphrase
 * to the technical contact of the pharmacy.
 */
export class SignerLockedError extends Error {
  constructor() {
    super(
      'La clave de firma de este dispositivo está protegida con una contraseña. ' +
        'Introdúzcala para continuar.',
    );
    this.name = 'SignerLockedError';
  }
}

/**
 * The shim was asked for something it does not implement.
 *
 * Never silent: a provider that returns `null` for an unknown method makes viem
 * fail somewhere else entirely, with an error about the consequence rather than
 * about the cause. The method name is in the message so the next person knows
 * exactly what to add.
 */
export class UnsupportedRpcMethodError extends Error {
  constructor(readonly method: string) {
    super(
      `El firmante local de este dispositivo no implementa el método ${method}. ` +
        'Solo admite eth_accounts, eth_chainId, eth_estimateGas y eth_sendTransaction.',
    );
    this.name = 'UnsupportedRpcMethodError';
  }
}

/** The transaction shape viem hands to `eth_sendTransaction`, all hex strings. */
interface JsonRpcTransactionRequest {
  from?: string;
  to?: string;
  data?: string;
  value?: string;
  gas?: string;
  nonce?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
}

export interface LocalKeySignerOptions {
  config: PharmacyConfig;
  /** Defaults to `localStorage`. Injected in tests. */
  storage?: Storage;
  /** Defaults to the global `fetch`. Injected in tests. */
  fetchImpl?: typeof globalThis.fetch;
}

/** `SignerPort` plus the passphrase lifecycle the access path drives. */
export type LocalKeySigner = SignerPort & DeviceKeyPort;

export function createLocalKeySigner(options: LocalKeySignerOptions): LocalKeySigner {
  const { config } = options;
  const storage = options.storage;
  const doFetch = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));

  /**
   * The ONLY place the decrypted key exists. Not exported, not returned, not
   * reachable from the object below except through the signing path.
   */
  let account: PrivateKeyAccount | null = null;

  let requestId = 0;

  /** JSON-RPC against `VITE_RPC_URL`. The only network this adapter talks to. */
  async function rpc(method: string, params: unknown[]): Promise<unknown> {
    requestId += 1;

    const response = await doFetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }),
    });

    if (!response.ok) {
      throw new Error(`El nodo respondió ${response.status} al método ${method}.`);
    }

    const payload = (await response.json()) as { result?: unknown; error?: { message?: string } };
    if (payload.error !== undefined) {
      throw new Error(payload.error.message ?? `El nodo rechazó el método ${method}.`);
    }

    return payload.result;
  }

  function requireUnlocked(): PrivateKeyAccount {
    if (account !== null) return account;
    if (hasKeystore(storage)) throw new SignerLockedError();
    throw new SignerUnavailableError();
  }

  function toBigInt(value: string | undefined): bigint | undefined {
    return value === undefined ? undefined : BigInt(value);
  }

  /**
   * Signs locally and broadcasts the result.
   *
   * The wallet client below is built over `custom({ request: rpc })`, so every
   * read it needs — nonce, fees, gas — and the final `eth_sendRawTransaction`
   * go to the configured node and nowhere else. viem signs with the local
   * account in memory; the key never crosses the transport.
   */
  async function sendTransaction(request: JsonRpcTransactionRequest): Promise<string> {
    const signing = requireUnlocked();

    if (
      request.from !== undefined &&
      request.from.toLowerCase() !== signing.address.toLowerCase()
    ) {
      throw new Error(
        `Este dispositivo solo puede firmar con la cuenta ${signing.address}, y se le pidió ` +
          `firmar con ${request.from}.`,
      );
    }

    const walletClient = createWalletClient({
      account: signing,
      chain: buildChain(config),
      transport: custom({ request: ({ method, params }) => rpc(method, (params ?? []) as never) }),
    });

    return walletClient.sendTransaction({
      to: (request.to ?? null) as ViemAddress | null,
      data: request.data as `0x${string}` | undefined,
      value: toBigInt(request.value),
      gas: toBigInt(request.gas),
      nonce: request.nonce === undefined ? undefined : Number(BigInt(request.nonce)),
      maxFeePerGas: toBigInt(request.maxFeePerGas),
      maxPriorityFeePerGas: toBigInt(request.maxPriorityFeePerGas),
    } as never);
  }

  /**
   * The minimum EIP-1193 surface `viem-chain.adapter.ts` exercises for a write:
   * `eth_chainId` (asserted against the client's chain), `eth_sendTransaction`
   * (the write itself), `eth_accounts` (identity) and `eth_estimateGas`, which
   * is forwarded because it is a read the node owns. Everything else refuses by
   * name rather than answering something plausible.
   */
  const provider: Eip1193Provider = {
    async request({ method, params }) {
      const args = (Array.isArray(params) ? params : []) as unknown[];

      switch (method) {
        case 'eth_accounts':
          return account === null ? [] : [account.address];

        case 'eth_chainId':
          return numberToHex(config.chainId);

        case 'eth_estimateGas':
          return rpc('eth_estimateGas', args);

        case 'eth_sendTransaction':
          return sendTransaction((args[0] ?? {}) as JsonRpcTransactionRequest);

        default:
          throw new UnsupportedRpcMethodError(method);
      }
    },
  };

  return {
    // --- SignerPort -------------------------------------------------------
    isAvailable() {
      return hasKeystore(storage);
    },

    getProvider() {
      return hasKeystore(storage) ? provider : undefined;
    },

    async getAccount() {
      return account === null ? null : (account.address as Address);
    },

    async connect() {
      return requireUnlocked().address as Address;
    },

    /**
     * Configuration, not a question for a node.
     *
     * There is no extension holding an opinion about which network it is on:
     * this device signs for exactly the chain `VITE_CHAIN_ID` names, against
     * exactly the node `VITE_RPC_URL` names.
     */
    async getChainId() {
      return config.chainId;
    },

    /**
     * WHY `wallet_switchEthereumChain` DOES NOT APPLY HERE. That method asks a
     * wallet application to change the network it is connected to. There is no
     * such application in this path — the "network" is two configuration values
     * baked into the build. So the only meaningful check is that the chain the
     * application asks for is the chain this device was configured for; a
     * mismatch is a deployment error, and silently signing on the wrong chain
     * would be the worst possible answer to it.
     */
    async ensureChain(chainId) {
      if (chainId === config.chainId) return;

      throw new Error(
        `Este dispositivo está configurado para la cadena ${config.chainId}, y la aplicación ` +
          `pidió la cadena ${chainId}. Revise la configuración antes de continuar.`,
      );
    },

    // --- DeviceKeyPort ----------------------------------------------------
    hasKey() {
      return hasKeystore(storage);
    },

    isUnlocked() {
      return account !== null;
    },

    async enrol(privateKey, passphrase) {
      const keystore = await encryptPrivateKey(privateKey, passphrase);
      saveKeystore(keystore, storage);

      // Decrypting what was just written, rather than reusing the plaintext,
      // proves the stored blob opens before the pharmacist walks away with a
      // device that only LOOKS configured.
      account = privateKeyToAccount(await decryptPrivateKey(keystore, passphrase));
      return account.address as Address;
    },

    async unlock(passphrase) {
      const keystore = loadKeystore(storage);
      if (keystore === null) throw new SignerUnavailableError();

      account = privateKeyToAccount(await decryptPrivateKey(keystore, passphrase));
      return account.address as Address;
    },

    lock() {
      account = null;
    },

    forget() {
      account = null;
      clearKeystore(storage);
    },
  };
}
