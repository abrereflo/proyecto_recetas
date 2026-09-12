import {
  createWalletClient,
  custom,
  verifyTypedData,
  type Address as ViemAddress,
  type Hex as ViemHex,
  type PublicClient,
} from 'viem';
import {
  PRESCRIPTION_EIP712_TYPES,
  PRESCRIPTION_PRIMARY_TYPE,
  PrescriptionStatus,
  prescriptionDomain,
  type Address,
  type Bytes32,
  type PrescriptionRecord,
  type VerificationResult,
} from '@recetas/shared';
import {
  ChainUnreachableError,
  type ChainPort,
  type DispenseReceipt,
} from '../../ports/chain.port';
import type {
  PrescriberSignatureInput,
  PrescriberSignatureVerifier,
} from '../../ports/signer.port';
import type { PharmacyConfig } from '../config/env';
import { injectedProvider, type Eip1193Provider } from '../signer/eip1193-signer.adapter';
import { prescriptionRegistryAbi } from './registry-abi';
import { buildChain, buildPublicClient } from './viem-chain';

/**
 * `ChainPort` over viem.
 *
 * Reads go through a plain HTTP public client; the single write goes through
 * `simulateContract` first, so a revert is decoded into a custom error with its
 * arguments before any gas is spent. That is what turns "transaction reverted"
 * into "ya fue dispensada el 12/09 por la farmacia X" (docs/04, docs/17 P6).
 *
 * HARD RULE (docs/03, docs/17): nothing but a `contentHash` and an account
 * address is ever sent to the chain from here. No patient identifier and no
 * commitment salt crosses this boundary.
 */

export interface ViemChainAdapterOptions {
  config: PharmacyConfig;
  publicClient?: PublicClient;
  /** Resolved lazily so a provider injected after load is still picked up. */
  getProvider?: () => Eip1193Provider | undefined;
}

/** The `MVP_NONCE` of apps/cli: the registry tracks no per-prescriber nonce yet. */
const MVP_NONCE = 0n;

export function createViemChainAdapter(options: ViemChainAdapterOptions): ChainPort {
  const { config } = options;
  const publicClient = options.publicClient ?? buildPublicClient(config);
  const getProvider = options.getProvider ?? injectedProvider;

  const registry = {
    address: config.registryAddress as ViemAddress,
    abi: prescriptionRegistryAbi,
  } as const;

  async function guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      // A transport failure is not a verdict about the prescription: it must
      // reach the screen as an incomplete verification, never as a rejection.
      if (isTransportFailure(error)) {
        throw new ChainUnreachableError(config.rpcUrl, { cause: error });
      }
      throw error;
    }
  }

  return {
    async blockTimestamp() {
      return guarded(async () => {
        const block = await publicClient.getBlock({ blockTag: 'latest' });
        return block.timestamp;
      });
    },

    async verify(contentHash: Bytes32): Promise<VerificationResult> {
      return guarded(async () => {
        const [status, dispensable, prescriber, expiresAt] = await publicClient.readContract({
          ...registry,
          functionName: 'verify',
          args: [contentHash as ViemHex],
        });

        return {
          status: status as PrescriptionStatus,
          dispensable,
          prescriber: prescriber as Address,
          expiresAt,
        };
      });
    },

    async getPrescription(contentHash: Bytes32): Promise<PrescriptionRecord> {
      return guarded(async () => {
        const record = await publicClient.readContract({
          ...registry,
          functionName: 'getPrescription',
          args: [contentHash as ViemHex],
        });

        return {
          prescriber: record.prescriber as Address,
          patientCommitment: record.patientCommitment as Bytes32,
          issuedAt: record.issuedAt,
          expiresAt: record.expiresAt,
          dispensedBy: record.dispensedBy as Address,
          dispensedAt: record.dispensedAt,
          status: record.status as PrescriptionStatus,
        };
      });
    },

    async credentialOf(account: Address): Promise<Bytes32> {
      return guarded(async () => {
        const uid = await publicClient.readContract({
          ...registry,
          functionName: 'credentialOf',
          args: [account as ViemAddress],
        });
        return uid as Bytes32;
      });
    },

    async dispense(contentHash: Bytes32, pharmacy: Address): Promise<DispenseReceipt> {
      const provider = getProvider();
      if (provider === undefined) {
        throw new Error('Este dispositivo no tiene configurada una cuenta de farmacia.');
      }

      const walletClient = createWalletClient({
        account: pharmacy as ViemAddress,
        chain: buildChain(config),
        transport: custom(provider),
      });

      // Simulation first: the revert arrives decoded, with its arguments, and
      // no gas is spent on a transaction the contract will refuse.
      const { request } = await publicClient.simulateContract({
        ...registry,
        functionName: 'dispense',
        args: [contentHash as ViemHex],
        account: pharmacy as ViemAddress,
      } as never);

      const transactionHash = await walletClient.writeContract(request as never);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
      const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });

      return {
        transactionHash: transactionHash as ViemHex,
        blockNumber: receipt.blockNumber,
        blockTimestamp: block.timestamp,
        dispensedBy: pharmacy,
      };
    },
  };
}

/**
 * `PrescriberSignatureVerifier` over viem's offline EIP-712 recovery.
 *
 * No network call is involved for an EOA signature. The domain and the type
 * definition come from @recetas/shared so the CLI, the doctor SPA and this PWA
 * verify exactly the structure the prescriber signed.
 *
 * TODO (docs/01): once prescribers move to ERC-4337 smart accounts this needs
 * the ERC-1271 `isValidSignature` path, which does require the public client.
 */
export function createPrescriberSignatureVerifier(
  config: PharmacyConfig,
): PrescriberSignatureVerifier {
  const domain = prescriptionDomain(config.registryAddress, config.chainId);

  return {
    async verify(input: PrescriberSignatureInput): Promise<boolean> {
      try {
        return await verifyTypedData({
          address: input.prescriber as ViemAddress,
          domain: {
            name: domain.name,
            version: domain.version,
            chainId: domain.chainId,
            verifyingContract: config.registryAddress as ViemAddress,
          },
          types: PRESCRIPTION_EIP712_TYPES,
          primaryType: PRESCRIPTION_PRIMARY_TYPE,
          message: {
            contentHash: input.contentHash as ViemHex,
            patientCommitment: input.patientCommitment as ViemHex,
            prescriber: input.prescriber as ViemAddress,
            issuedAt: input.issuedAt,
            expiresAt: input.expiresAt,
            nonce: MVP_NONCE,
          },
          signature: input.signature as ViemHex,
        });
      } catch {
        // A malformed signature is an invalid signature, not a crash.
        return false;
      }
    },
  };
}

function isTransportFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return (
    name === 'HttpRequestError' ||
    name === 'TimeoutError' ||
    name === 'SocketClosedError' ||
    name === 'TypeError'
  );
}
