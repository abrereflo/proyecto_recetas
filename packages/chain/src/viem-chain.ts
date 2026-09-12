import { createPublicClient, defineChain, http, type Chain, type PublicClient } from 'viem';

/**
 * Chain plumbing, built from configuration instead of importing `avalancheFuji`.
 *
 * SINGLE SOURCE. This was duplicated between apps/cli/src/chain.ts and
 * apps/pharmacy/src/infrastructure/chain/viem-chain.ts, whose own header said
 * "Mirrors apps/cli/src/chain.ts". The same code drives Anvil today and the
 * public testnet once the deployment lands, with no code change (docs/08).
 *
 * The parameter is the narrowest shape that does the job, so every app's own
 * config object satisfies it structurally without this package knowing anything
 * about API urls, registry addresses or private keys.
 */

export interface ChainConfig {
  chainId: number;
  rpcUrl: string;
}

/** Avalanche Fuji, the integration network (docs/01-arquitectura.md). */
const FUJI_CHAIN_ID = 43113;

/**
 * The native coin is not always Ether.
 *
 * Avalanche is an independent L1, not an Ethereum L2, and its C-Chain pays gas
 * in AVAX. Hardcoding Ether here used to be harmless while everything ran on an
 * Ethereum testnet; on Fuji it would make viem label every fee in a currency
 * that does not exist on the chain.
 */
function nativeCurrencyOf(chainId: number): Chain['nativeCurrency'] {
  if (chainId === FUJI_CHAIN_ID) {
    return { name: 'Avalanche', symbol: 'AVAX', decimals: 18 };
  }

  return { name: 'Ether', symbol: 'ETH', decimals: 18 };
}

export function buildChain(config: ChainConfig): Chain {
  return defineChain({
    id: config.chainId,
    name: config.chainId === 31337 ? 'Anvil' : `Cadena ${config.chainId}`,
    nativeCurrency: nativeCurrencyOf(config.chainId),
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
}

export function buildPublicClient(config: ChainConfig): PublicClient {
  return createPublicClient({
    chain: buildChain(config),
    transport: http(config.rpcUrl),
  });
}
