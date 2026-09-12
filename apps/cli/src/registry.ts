import type { Account, Address, Hex, PublicClient, WalletClient } from 'viem';
import { PrescriptionStatus } from '@recetas/shared';
import { prescriptionRegistryAbi } from './registry-abi';
import type { CliConfig } from './config';

/**
 * Read and write access to PrescriptionRegistry.
 *
 * Every write goes through `simulateContract` first, so a revert is decoded
 * into a custom error with its arguments before any gas is spent. That is what
 * turns "transaction reverted" into "already dispensed on 12/09 by pharmacy X".
 */

export interface RegistryState {
  status: PrescriptionStatus;
  /** As returned by the contract: already folds the expiry condition in. */
  dispensable: boolean;
  prescriber: Address;
  expiresAt: bigint;
  /** Derived on the client: `Expired` is not a value of the on-chain enum. */
  expired: boolean;
  /** Spanish label for the terminal, including the derived "Caducada". */
  label: string;
}

export interface RegistryRecord {
  prescriber: Address;
  patientCommitment: Hex;
  issuedAt: bigint;
  expiresAt: bigint;
  dispensedBy: Address;
  dispensedAt: bigint;
  status: PrescriptionStatus;
}

/**
 * "Caducada" is derived, never read from the enum.
 *
 * A client that waits for an enum value that never arrives shows "Emitida" over
 * an expired prescription, and the pharmacist finds out when the transaction
 * fails (docs/17-diseno-y-experiencia.md).
 */
function labelFor(status: PrescriptionStatus, expired: boolean): string {
  switch (status) {
    case PrescriptionStatus.None:
      return 'No registrada';
    case PrescriptionStatus.Issued:
      return expired ? 'Caducada' : 'Emitida';
    case PrescriptionStatus.Dispensed:
      return 'Dispensada';
    case PrescriptionStatus.Cancelled:
      return 'Anulada';
    default:
      return 'Desconocida';
  }
}

export async function readState(
  client: PublicClient,
  config: CliConfig,
  contentHash: Hex,
  blockTime: bigint,
): Promise<RegistryState> {
  const [status, dispensable, prescriber, expiresAt] = await client.readContract({
    address: config.registryAddress,
    abi: prescriptionRegistryAbi,
    functionName: 'verify',
    args: [contentHash],
  });

  const typedStatus = status as PrescriptionStatus;
  const expired = typedStatus === PrescriptionStatus.Issued && blockTime >= expiresAt;

  return {
    status: typedStatus,
    dispensable,
    prescriber,
    expiresAt,
    expired,
    label: labelFor(typedStatus, expired),
  };
}

export async function readRecord(
  client: PublicClient,
  config: CliConfig,
  contentHash: Hex,
): Promise<RegistryRecord> {
  const record = await client.readContract({
    address: config.registryAddress,
    abi: prescriptionRegistryAbi,
    functionName: 'getPrescription',
    args: [contentHash],
  });

  return {
    prescriber: record.prescriber,
    patientCommitment: record.patientCommitment,
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    dispensedBy: record.dispensedBy,
    dispensedAt: record.dispensedAt,
    status: record.status as PrescriptionStatus,
  };
}

export interface TransactionOutcome {
  hash: Hex;
  blockNumber: bigint;
  gasUsed: bigint;
}

async function send(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: Account,
  data: { functionName: 'issue'; args: [Hex, Hex, bigint] } | { functionName: 'dispense' | 'cancel'; args: [Hex] },
  config: CliConfig,
): Promise<TransactionOutcome> {
  const { request } = await publicClient.simulateContract({
    address: config.registryAddress,
    abi: prescriptionRegistryAbi,
    account,
    ...data,
  } as never);

  const hash = await walletClient.writeContract(request as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  // `waitForTransactionReceipt` resolves for a reverted transaction exactly as
  // it does for a mined one: the verdict is in `status`, not in a thrown error.
  // The simulation above catches the ordinary refusals, but it cannot catch a
  // race — another pharmacy dispensing between the simulation and inclusion —
  // and printing that as a success is the opposite of what the demo proves.
  if (receipt.status !== 'success') {
    throw new Error(
      `La transacción ${hash} revirtió en la cadena (bloque ${receipt.blockNumber}).\n` +
        'El estado en la cadena no cambió. Vuelva a consultar la receta antes de reintentar.',
    );
  }

  return { hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed };
}

export async function issueOnChain(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: Account,
  config: CliConfig,
  args: { contentHash: Hex; patientCommitment: Hex; expiresAt: bigint },
): Promise<TransactionOutcome> {
  return send(
    publicClient,
    walletClient,
    account,
    {
      functionName: 'issue',
      args: [args.contentHash, args.patientCommitment, args.expiresAt],
    },
    config,
  );
}

export async function dispenseOnChain(
  publicClient: PublicClient,
  walletClient: WalletClient,
  account: Account,
  config: CliConfig,
  contentHash: Hex,
): Promise<TransactionOutcome> {
  return send(publicClient, walletClient, account, { functionName: 'dispense', args: [contentHash] }, config);
}
