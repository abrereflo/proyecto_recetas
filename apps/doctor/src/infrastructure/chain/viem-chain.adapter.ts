import {
  createWalletClient,
  custom,
  getAbiItem,
  type Address as ViemAddress,
  type Hex as ViemHex,
  type PublicClient,
} from 'viem';
import { buildChain, buildPublicClient, prescriptionRegistryAbi } from '@recetas/chain';
import {
  PrescriptionStatus,
  type Address,
  type Bytes32,
  type PrescriptionRecord,
} from '@recetas/shared';
import {
  ChainUnreachableError,
  type ChainPort,
  type IssueReceipt,
  type IssuedPrescriptionLog,
  type IssueRequest,
} from '../../ports/chain.port';
import type { DoctorConfig } from '../config/env';
import { SignerRejectedError } from '../../ports/signer.port';
import {
  USER_REJECTED,
  errorCode,
  injectedProvider,
  type Eip1193Provider,
} from '../signer/eip1193-signer.adapter';

/**
 * `ChainPort` over viem.
 *
 * The ABI, the chain plumbing and the revert decoding all come from
 * @recetas/chain; nothing is re-copied here (review finding read-001, lineage
 * review-fbc6fee420beae2b). What is this app's own is which calls it makes.
 *
 * Reads go through a plain HTTP public client; the single write goes through
 * `simulateContract` first, so a revert is decoded into a custom error with its
 * arguments before any gas is spent. That is what turns "transaction reverted"
 * into "ya existe una receta con esta huella" (docs/04, docs/17).
 *
 * HARD RULE (docs/03, docs/17): the only values this file sends to the chain are
 * a `contentHash`, a `patientCommitment`, an expiry instant and an account
 * address. The patient identifier and the commitment salt never cross this
 * boundary — `IssueRequest` has no field that could carry them.
 */

export interface ViemChainAdapterOptions {
  config: DoctorConfig;
  publicClient?: PublicClient;
  /** Resolved lazily so a provider injected after load is still picked up. */
  getProvider?: () => Eip1193Provider | undefined;
  /**
   * First block scanned by `issuedBy`. The registry did not exist before its
   * deployment block, so scanning from zero is only wasted work; a public RPC
   * will also refuse a range this wide (see application/list-prescriptions.ts).
   */
  fromBlock?: bigint;
}

const PRESCRIPTION_ISSUED_EVENT = getAbiItem({
  abi: prescriptionRegistryAbi,
  name: 'PrescriptionIssued',
});

export function createViemChainAdapter(options: ViemChainAdapterOptions): ChainPort {
  const { config } = options;
  const publicClient = options.publicClient ?? buildPublicClient(config);
  const getProvider = options.getProvider ?? injectedProvider;
  const fromBlock = options.fromBlock ?? 0n;

  const registry = {
    address: config.registryAddress as ViemAddress,
    abi: prescriptionRegistryAbi,
  } as const;

  async function guarded<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      // A transport failure is not a verdict about the receta: it must reach
      // the screen as an incomplete operation, never as a refusal.
      if (isTransportFailure(error)) {
        throw new ChainUnreachableError(config.rpcUrl, { cause: error });
      }
      throw error;
    }
  }

  const port: ChainPort = {
    async blockTimestamp() {
      return guarded(async () => {
        const block = await publicClient.getBlock({ blockTag: 'latest' });
        return block.timestamp;
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

    async issuedBy(prescriber: Address): Promise<IssuedPrescriptionLog[]> {
      return guarded(async () => {
        // `prescriber` is an INDEXED topic of `PrescriptionIssued`, so the node
        // filters by it and this is a real query rather than a full scan of the
        // registry's logs. It is still the only index the MVP has: there is no
        // `prescriptionsOf(address)` view in the contract.
        const logs = await publicClient.getLogs({
          address: config.registryAddress as ViemAddress,
          event: PRESCRIPTION_ISSUED_EVENT,
          args: { prescriber: prescriber as ViemAddress },
          fromBlock,
          toBlock: 'latest',
        });

        return logs.flatMap((log): IssuedPrescriptionLog[] => {
          const { contentHash, patientCommitment, expiresAt } = log.args;

          // A log missing an argument is a malformed node answer, not a
          // prescription. Dropping it is better than inventing a row for D7.
          if (
            contentHash === undefined ||
            patientCommitment === undefined ||
            expiresAt === undefined ||
            log.blockNumber === null ||
            log.transactionHash === null
          ) {
            return [];
          }

          return [
            {
              contentHash: contentHash as Bytes32,
              prescriber,
              patientCommitment: patientCommitment as Bytes32,
              expiresAt,
              blockNumber: log.blockNumber,
              transactionHash: log.transactionHash,
            },
          ];
        });
      });
    },

    async issue(request: IssueRequest): Promise<IssueReceipt> {
      const provider = getProvider();
      if (provider === undefined) {
        throw new Error('Este equipo no tiene configurada una cuenta médica para firmar.');
      }

      const walletClient = createWalletClient({
        account: request.prescriber as ViemAddress,
        chain: buildChain(config),
        transport: custom(provider),
      });

      // Simulation first: the revert arrives decoded, with its arguments, and
      // no gas is spent on a transaction the contract will refuse.
      const { request: simulated } = await publicClient.simulateContract({
        ...registry,
        functionName: 'issue',
        args: [
          request.contentHash as ViemHex,
          request.patientCommitment as ViemHex,
          request.expiresAt,
        ],
        account: request.prescriber as ViemAddress,
      } as never);

      const transactionHash = await walletClient
        .writeContract(simulated as never)
        .catch(asPrescriberDecision);
      const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
      const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });

      return {
        transactionHash: transactionHash as ViemHex,
        blockNumber: receipt.blockNumber,
        blockTimestamp: block.timestamp,
      };
    },
  };

  // `issue` is guarded exactly like the reads (R4-001): a transport failure
  // mid-anchor must arrive as `ChainUnreachableError`, never as a verdict.
  return { ...port, issue: (request) => guarded(() => port.issue(request)) };
}

/** Declining the transaction prompt is a decision, not a network fault. */
export function asPrescriberDecision(error: unknown): never {
  if (errorCode(error) === USER_REJECTED) throw new SignerRejectedError({ cause: error });
  throw error;
}

function isTransportFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return (
    name === 'HttpRequestError' ||
    name === 'TimeoutError' ||
    name === 'SocketClosedError' ||
    // The broadcast landed but the receipt never arrived: the case R4-001 is about.
    name === 'WaitForTransactionReceiptTimeoutError' ||
    name === 'TypeError'
  );
}
