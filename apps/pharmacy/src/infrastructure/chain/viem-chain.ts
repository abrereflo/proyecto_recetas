import { createPublicClient, defineChain, http, type Chain, type PublicClient } from 'viem';
import type { PharmacyConfig } from '../config/env';

/**
 * Chain plumbing, built from configuration instead of importing `baseSepolia`.
 *
 * The same PWA drives Anvil today and the public testnet once the deployment
 * lands, with no code change (docs/08). Mirrors apps/cli/src/chain.ts.
 */

export function buildChain(config: PharmacyConfig): Chain {
  return defineChain({
    id: config.chainId,
    name: config.chainId === 31337 ? 'Anvil' : `Cadena ${config.chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
}

export function buildPublicClient(config: PharmacyConfig): PublicClient {
  return createPublicClient({
    chain: buildChain(config),
    transport: http(config.rpcUrl),
  });
}
