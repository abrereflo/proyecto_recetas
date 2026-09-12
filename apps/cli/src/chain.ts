import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Chain,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import type { CliConfig } from './config';

/**
 * Chain plumbing.
 *
 * The chain is built from configuration instead of importing `baseSepolia`, so
 * the same CLI drives Anvil today and the public testnet once phase 2 finishes,
 * with no code change.
 */
export function buildChain(config: CliConfig): Chain {
  return defineChain({
    id: config.chainId,
    name: config.chainId === 31337 ? 'Anvil' : `Cadena ${config.chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
}

export function buildPublicClient(config: CliConfig): PublicClient {
  return createPublicClient({
    chain: buildChain(config),
    transport: http(config.rpcUrl),
  });
}

export function buildWalletClient(config: CliConfig, privateKey: Hex): WalletClient {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: buildChain(config),
    transport: http(config.rpcUrl),
  });
}

export function accountOf(privateKey: Hex): PrivateKeyAccount {
  return privateKeyToAccount(privateKey);
}

/**
 * Block timestamp, in seconds.
 *
 * Expiry is derived by comparing `expiresAt` with block time, never with the
 * host clock: a laptop with a skewed clock must not disagree with the contract
 * (docs/17-diseno-y-experiencia.md).
 */
export async function blockTimestamp(client: PublicClient): Promise<bigint> {
  const block = await client.getBlock({ blockTag: 'latest' });
  return block.timestamp;
}

/** Turns an unreachable node into an actionable message instead of a stack trace. */
export async function assertChainReachable(client: PublicClient, rpcUrl: string): Promise<void> {
  try {
    await client.getChainId();
  } catch {
    throw new Error(
      `No hay respuesta del nodo en ${rpcUrl}. Levante la infraestructura con "docker compose up -d".`,
    );
  }
}
