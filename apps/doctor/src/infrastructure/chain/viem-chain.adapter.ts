import {
  BaseError,
  ChainDisconnectedError,
  ContractFunctionExecutionError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  ProviderDisconnectedError,
  ProviderRpcError,
  RpcError,
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
  TransactionRevertedError,
  type ChainPort,
  type IssueReceipt,
  type IssuedPrescriptionLog,
  type IssueRequest,
} from '../../ports/chain.port';
import type { DoctorConfig } from '../config/env';
import { SignerRejectedError, type SignerPort } from '../../ports/signer.port';
import { USER_REJECTED, errorCode } from '../eip1193-errors';

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
  /**
   * The write path's only source of a provider (Corte 2,
   * docs/21-acceso-para-la-demo.md). This adapter never reaches for
   * `window.ethereum` on its own: it asks the port, so a different signer —
   * the ERC-4337/passkey one of D-04 — is a change to the composition root,
   * not to this file.
   */
  signer: Pick<SignerPort, 'getProvider'>;
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
  const { config, signer } = options;
  const publicClient = options.publicClient ?? buildPublicClient(config);
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
      const provider = signer.getProvider();
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

      // A REVERTED TRANSACTION RESOLVES ITS RECEIPT TOO (R4-001): viem does not
      // throw for it, and this is the only thing between a mined-and-refused
      // `issue` and a QR that the pharmacy will resolve as `None`.
      if (receipt.status !== 'success') throw new TransactionRevertedError(transactionHash as ViemHex);

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

/** JSON-RPC code of a reverted execution: a verdict, never a transport fault. */
const EXECUTION_REVERTED = 3;
/**
 * Transport failure or verdict, on viem's error HIERARCHY, never on a list of
 * class NAMES (R4-002): the receipt poller rejects with the RAW underlying error,
 * so a rate-limited node arrives as `LimitExceededRpcError`, an `RpcError`
 * subclass no allowlist keeps up with that escaped `guarded()` after a successful
 * broadcast and stranded the anchor. The rule is inverted: every viem error is
 * lost transport EXCEPT an ANSWER — a provider decision, or a contract verdict,
 * which also reaches here raw as its JSON-RPC code.
 *
 * The one class that says NOTHING about which of the two it is —
 * `ContractFunctionExecutionError` — is decided by `answeredWithRevert`.
 *
 * `ProviderRpcError` is exempted because a provider DECISION arrives as one,
 * but not every subclass is a decision: EIP-1193 reserves 4900 and 4901 for the
 * provider reporting that it is not connected, and viem models both as
 * `ProviderRpcError` subclasses. They are classified first, below.
 */
function isTransportFailure(error: unknown): boolean {
  // A bare `fetch` failure never becomes a viem error.
  if (error instanceof TypeError) return true;
  if (!(error instanceof BaseError)) return false;
  // EIP-1193 4900/4901, BEFORE the `ProviderRpcError` exemption they both
  // inherit from: a wallet reporting "disconnected" right after the broadcast
  // is lost transport, not an answer. Exempted, it reaches the pipeline
  // unmodelled, matches no branch and is rethrown, so the screen reports a
  // generic failure with NO attempt attached — and the anchor that may already
  // be mined can never be recovered (R4-002).
  if (error instanceof ProviderDisconnectedError) return true;
  if (error instanceof ChainDisconnectedError) return true;
  // Everything else in the family is the provider ANSWERING, `UserRejectedRequestError` above all.
  if (error instanceof ProviderRpcError) return false;
  // NEVER exempt this class by TYPE (see `answeredWithRevert`).
  if (error instanceof ContractFunctionExecutionError) return !answeredWithRevert(error);
  return !(error instanceof RpcError && error.code === EXECUTION_REVERTED);
}

/**
 * Whether a failed contract call carries the chain's REFUSAL, or only the fact
 * that the call did not get through.
 *
 * `ContractFunctionExecutionError` cannot be exempted by type. Every contract
 * call viem makes — `simulateContract`, `readContract` and, above all,
 * `writeContract` — catches whatever was thrown and hands it to
 * `getContractError`, which returns that class UNCONDITIONALLY; all it varies
 * is what it puts in `cause`. A dropped HTTP request and a reverting contract
 * therefore arrive as the SAME top-level class, and the answer only exists
 * further down the chain. (`waitForTransactionReceipt` and `getBlock` do not
 * wrap at all, which is why the raw-`RpcError` rule in the classifier stands.)
 *
 * Exempting the class is worst at `writeContract`: that call IS the broadcast,
 * a transport failure there is exactly the case where nobody knows whether the
 * transaction reached the node, and calling it a verdict loses the attempt —
 * an anchored receta whose decryption key died with the closure.
 *
 * So walk the cause chain for the signals `getContractError` leaves when the
 * contract actually answered: the decoded revert, the empty return, or the
 * reverting node answer itself by JSON-RPC code (read by code and not by class
 * because `RpcRequestError` carries code 3 without being an `RpcError`).
 */
function answeredWithRevert(error: BaseError): boolean {
  return error.walk(isRevertSignal) !== null;
}

function isRevertSignal(candidate: unknown): boolean {
  if (candidate instanceof ContractFunctionRevertedError) return true;
  if (candidate instanceof ContractFunctionZeroDataError) return true;
  return errorCode(candidate) === EXECUTION_REVERTED;
}
