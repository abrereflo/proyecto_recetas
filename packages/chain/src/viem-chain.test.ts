import { describe, expect, it } from 'vitest';
import { buildChain, buildPublicClient } from './viem-chain';

/**
 * The chain is built from configuration, never from an imported `baseSepolia`.
 * A hardcoded chain is how a client ends up quietly talking to the wrong
 * network, so the configured values have to survive intact (docs/08).
 */

const ANVIL = { chainId: 31337, rpcUrl: 'http://localhost:8545' };
const BASE_SEPOLIA = { chainId: 84532, rpcUrl: 'https://sepolia.base.org' };

describe('buildChain', () => {
  it('uses the configured chain id and rpc url', () => {
    const chain = buildChain(BASE_SEPOLIA);

    expect(chain.id).toBe(84532);
    expect(chain.rpcUrls.default.http).toEqual(['https://sepolia.base.org']);
  });

  it('names the local development chain Anvil', () => {
    expect(buildChain(ANVIL).name).toBe('Anvil');
  });

  it('names any other chain by its id', () => {
    expect(buildChain(BASE_SEPOLIA).name).toBe('Cadena 84532');
  });

  it('uses ETH as the native currency', () => {
    expect(buildChain(ANVIL).nativeCurrency).toEqual({
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    });
  });
});

describe('buildPublicClient', () => {
  it('is bound to the configured chain', () => {
    expect(buildPublicClient(BASE_SEPOLIA).chain?.id).toBe(84532);
  });

  it('transports over the configured rpc url', () => {
    expect(buildPublicClient(ANVIL).transport['url']).toBe('http://localhost:8545');
  });
});
