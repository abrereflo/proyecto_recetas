import { createPublicClient, defineChain, http, type Chain, type PublicClient } from 'viem';

/**
 * Chain plumbing, built from configuration instead of importing `baseSepolia`.
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

export function buildChain(config: ChainConfig): Chain {
  return defineChain({
    id: config.chainId,
    name: config.chainId === 31337 ? 'Anvil' : `Cadena ${config.chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
}

export function buildPublicClient(config: ChainConfig): PublicClient {
  return createPublicClient({
    chain: buildChain(config),
    transport: http(config.rpcUrl),
  });
}
